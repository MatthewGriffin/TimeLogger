/**
 * Notes management tools
 */

import { db } from '../index.js';
import { ollamaClient } from '../api/ollama-client.js';

// The only built-in topic. Every other topic comes from actual use, so an
// empty category never lingers in the list.
const DEFAULT_NOTE_TOPICS = ['General'];
// Delete an unused custom category after a note leaves it. General is permanent.
function removeEmptyTopic(topic) {
  const name = String(topic || '').trim();
  if (!name || name.toLowerCase() === 'general') return;
  const used = db.prepare('SELECT 1 FROM notes WHERE topic = ? COLLATE NOCASE LIMIT 1').get(name);
  if (!used) db.prepare('DELETE FROM note_topics WHERE name = ? COLLATE NOCASE').run(name);
}


/**
 * Topics are no longer a fixed enum: any topic ever used on a note is a
 * "known" topic going forward, alongside the single built-in default. A
 * topic therefore disappears from the list as soon as its last note is
 * deleted or recategorised, so empty categories never accumulate.
 *
 * Ticket-linked notes use their ticket number as the topic, so those are
 * excluded here - they are per-ticket buckets, not reusable categories, and
 * feeding them to the LLM would just be noise.
 */
function getKnownTopics() {
  const rows = db.prepare(`
    SELECT name AS topic FROM note_topics
    UNION
    SELECT DISTINCT topic FROM notes
    WHERE topic IS NOT NULL AND topic <> ''
      AND (ticket_id IS NULL OR ticket_id = '' OR topic <> ticket_id)
  `).all();
  const used = rows.map(row => row.topic);
  const known = [...DEFAULT_NOTE_TOPICS];
  for (const topic of used) {
    if (!known.some(existing => existing.toLowerCase() === topic.toLowerCase())) known.push(topic);
  }
  return known;
}

/**
 * The fallback bucket. It is kept out of the matching step so the model
 * cannot dump a note into "General" when the note plainly has a real subject
 * of its own.
 */
const CATCH_ALL_TOPICS = ['General'];

const isCatchAll = (topic) =>
  CATCH_ALL_TOPICS.some(catchAll => catchAll.toLowerCase() === String(topic).toLowerCase());

/**
 * Normalise a raw model answer into a bare topic name. Small models like to
 * answer "Topic: Meeting" or wrap the name in quotes; left unchecked that
 * prefix ends up saved as part of the topic itself.
 */
function normalizeTopicAnswer(raw) {
  return String(raw || '')
    .trim()
    .split('\n')[0]
    .replace(/^\s*(?:the\s+)?(?:topic|category|answer)\s*[:\-]\s*/i, '')
    .replace(/^["'`*\s]+|["'`*.\s]+$/g, '')
    .trim();
}

/**
 * Guard against the model inventing a topic so narrow that no other note
 * would ever land in it. Anything wordy, or carrying digits/ticket-like
 * tokens, is treated as a description of one note rather than a category.
 */
function isReusableTopic(topic) {
  const trimmed = topic.trim();
  if (trimmed.length < 3 || trimmed.length > 30) return false;
  if (/\d/.test(trimmed)) return false;
  return trimmed.split(/\s+/).length <= 2;
}

/**
 * Look for an existing topic named in the note itself. This is the strongest
 * and cheapest signal available: if a note talks about Copilot and a Copilot
 * topic already exists, that is where it belongs, and no model call is
 * needed at all. Longer topic names are preferred so a more specific match
 * beats a shorter one it contains.
 */
function findTopicMentionedInNote(text, knownTopics) {
  const haystack = String(text || '');
  if (!haystack.trim()) return null;
  const candidates = knownTopics
    .filter(topic => !isCatchAll(topic) && topic.trim().length >= 3)
    .sort((a, b) => b.length - a.length);
  return candidates.find(topic => {
    const escaped = topic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'i').test(haystack);
  }) || null;
}

/**
 * Loose comparison so trivial wording differences still count as the same
 * topic: case, plurals and punctuation are ignored.
 */
function topicKey(topic) {
  return String(topic)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/s\b/g, '');
}

/**
 * Match an extracted subject against the topics that already exist, so a
 * second note about the same thing lands in the same place. Catch-all
 * buckets are not matchable - they are a fallback, not a destination.
 */
function matchKnownTopic(subject, knownTopics) {
  const key = topicKey(subject);
  if (!key) return null;
  const candidates = knownTopics.filter(topic => !isCatchAll(topic));
  const exact = candidates.find(topic => topicKey(topic) === key);
  if (exact) return exact;
  // "Copilot Usage" should still land in an existing "Copilot" topic.
  return candidates.find(topic => {
    const candidateKey = topicKey(topic);
    if (candidateKey.length < 4 || key.length < 4) return false;
    // Match whole normalized phrases only, not arbitrary substrings.
    return (` ${key} `).includes(` ${candidateKey} `) || (` ${candidateKey} `).includes(` ${key} `);
  }) || null;
}

/**
 * Categorising a note sits directly in the save path, so it gets a hard time
 * budget: the note must never be held up by a slow or busy model. If the
 * budget is spent the note is simply filed under the default topic, which
 * the user can change later.
 */
const CATEGORIZE_BUDGET_MS = 12000;

/**
 * Run an AI step against the remaining budget. Returns null rather than
 * throwing when time runs out, so callers degrade instead of failing.
 */
async function withinBudget(deadline, run) {
  const remaining = deadline - Date.now();
  if (remaining <= 500) return null;
  try {
    return await run(remaining);
  } catch {
    return null;
  }
}

/**
 * Work out which topic a note belongs to, judging the title and body
 * together. Rather than forcing the note into a fixed list (which pushed
 * almost everything into "General"), the model is asked what the note is
 * actually about and that subject is then reconciled with existing topics.
 *
 * Only one model call is made. Asking a small local model to then pick
 * between the extracted subject and the existing topics proved actively
 * harmful - it would file a note about a dentist appointment under an
 * unrelated existing topic - and mis-filing into the wrong bucket is worse
 * than offering a new one, which the user gets to confirm. Skipping that
 * second call also halves how long categorising takes.
 *
 * The subject is deliberately requested as a short, general theme so notes
 * about the same thing collect together instead of every note minting its
 * own hyper-specific category.
 *
 * A new topic is returned for the caller to confirm with the user before it
 * is saved.
 */
async function suggestTopic(note, knownTopics, title) {
  const available = await ollamaClient.initialize();
  if (!available) return { topic: 'General', isNew: false, available: false };

  const cleanTitle = String(title || '').trim();
  const body = String(note || '').trim().slice(0, 1500);
  const deadline = Date.now() + CATEGORIZE_BUDGET_MS;

  // An existing topic named in the note wins outright - it is both the most
  // reliable signal and free, so common notes never wait on the model.
  const mentioned = findTopicMentionedInNote(`${cleanTitle}\n${body}`, knownTopics);
  if (mentioned) return { topic: mentioned, isNew: false, available: true };

  try {
    const subject = await withinBudget(deadline, timeoutMs => extractSubject(cleanTitle, body, timeoutMs));
    if (!subject) return { topic: 'General', isNew: false, available: true };

    // A subject naming a topic that already exists reuses it as-is.
    const named = matchKnownTopic(subject, knownTopics);
    if (named) return { topic: named, isNew: false, available: true };

    if (!isReusableTopic(subject)) return { topic: 'General', isNew: false, available: true };
    return { topic: toTitleCase(subject), isNew: true, available: true };
  } catch {
    return { topic: 'General', isNew: false, available: true };
  }
}

/**
 * Ask what the note is about, with no list of topics in the prompt - naming
 * candidate topics up front anchors a small model and it simply echoes one
 * back. The answer is capped at two words to keep topics broad.
 */
async function extractSubject(title, body, timeoutMs) {
  const prompt = `Identify the main subject of this work note.\n\nNote title: ${title || '(none)'}\nNote content: ${body}\n\nName the product, application, system, technology, activity or broad area the note is about. Use the title as a strong clue when it names a subject directly. Do not choose a category based on unrelated words or invent a different product. Do not describe what happened in the note, and do not include names of people, ticket numbers or error messages. If the subject is a specific product or technology, use its proper name. Answer with a concise category name of 1 or 2 words only.`;

  const result = await ollamaClient.generate(prompt, null, { options: { temperature: 0 }, timeoutMs });
  const answer = normalizeTopicAnswer(result?.response);
  if (!answer) return null;
  // Small models sometimes still answer in a sentence; take the leading words.
  const words = answer.replace(/[^\w\s-]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 6) return null;
  return words.slice(0, 2).join(' ');
}

function toTitleCase(text) {
  return String(text)
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export const tools = [
  {
    name: 'get_note_topics',
    description: 'List all saved note categories, including categories that currently have no notes',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: async () => ({ success: true, topics: getKnownTopics() })
  },
  {
    name: 'create_note_topic',
    description: 'Create a reusable category for notes and AI categorization',
    parameters: {
      type: 'object',
      properties: { topic: { type: 'string', description: 'Category name, 1 to 30 characters' } },
      required: ['topic']
    },
    handler: async (args) => {
      const topic = String(args.topic || '').trim().replace(/\s+/g, ' ');
      if (!topic || topic.length > 30) {
        return { success: false, message: 'Category names must be between 1 and 30 characters' };
      }
      const existing = getKnownTopics().find(item => item.toLowerCase() === topic.toLowerCase());
      if (existing) return { success: true, topic: existing, topics: getKnownTopics(), alreadyExists: true };
      db.prepare('INSERT OR IGNORE INTO note_topics (name) VALUES (?)').run(topic);
      return { success: true, topic, topics: getKnownTopics() };
    }
  },
  {
    name: 'delete_note_topic',
    description: 'Delete a category and its notes, or move the notes to another category. General cannot be deleted.',
    parameters: { type: 'object', properties: { topic: { type: 'string' }, move_to: { type: 'string' } }, required: ['topic'] },
    handler: async (args) => {
      try {
        const topic = String(args.topic || '').trim();
        if (!topic) return { success: false, message: 'Category name is required' };
        if (topic.toLowerCase() === 'general') return { success: false, message: 'The General category cannot be deleted' };
        const existing = getKnownTopics().find(item => item.toLowerCase() === topic.toLowerCase());
        if (!existing) return { success: false, message: 'Category not found' };
        const target = String(args.move_to || '').trim().replace(/\s+/g, ' ');
        if (target && target.toLowerCase() === existing.toLowerCase()) return { success: false, message: 'Choose a different destination category' };
        if (target.length > 30) return { success: false, message: 'Category names must be 30 characters or fewer' };
        const count = Number(db.prepare('SELECT COUNT(*) AS count FROM notes WHERE topic = ? COLLATE NOCASE').get(existing)?.count || 0);
        db.transaction(() => {
          if (target) {
            db.prepare('INSERT OR IGNORE INTO note_topics (name) VALUES (?)').run(target);
            db.prepare('UPDATE notes SET topic = ?, updated_at = CURRENT_TIMESTAMP WHERE topic = ? COLLATE NOCASE').run(target, existing);
          } else {
            db.prepare('DELETE FROM notes WHERE topic = ? COLLATE NOCASE').run(existing);
          }
          db.prepare('DELETE FROM note_topics WHERE name = ? COLLATE NOCASE').run(existing);
        })();
        return { success: true, topic: existing, movedTo: target || null, affectedNotes: count, deletedNotes: target ? 0 : count, topics: getKnownTopics() };
      } catch (error) {
        return { success: false, message: 'Failed to delete category: ' + error.message };
      }
    }
  },
  {
    name: 'suggest_note_topic',
    description: 'Ask the local AI to suggest a topic for a note, flagging whether it is a brand-new topic that needs user confirmation',
    parameters: {
      type: 'object',
      properties: {
        note: { type: 'string', description: 'Note content to categorize' },
        title: { type: 'string', description: 'Note title, considered alongside the content when picking a topic' },
        ticket_id: { type: 'string', description: 'Associated Jira ticket; when set the topic is always the ticket number' }
      },
      required: ['note']
    },
    handler: async (args) => {
      try {
        const knownTopics = getKnownTopics();
        // A ticket-linked note is never categorized by the AI: its topic is
        // the ticket number, and it is not a "new topic" to confirm.
        const ticketId = (args.ticket_id || '').trim();
        if (ticketId) {
          return { success: true, topic: ticketId, isNew: false, isTicket: true, knownTopics };
        }
        if (!args.note || !args.note.trim()) {
          return { success: true, topic: 'General', isNew: false, knownTopics };
        }
        const { topic, isNew, available } = await suggestTopic(args.note, knownTopics, args.title);
        return {
          success: true,
          topic,
          isNew,
          knownTopics,
          message: available ? undefined : 'Ollama not available; defaulted to General'
        };
      } catch (error) {
        return {
          success: false,
          topic: 'General',
          isNew: false,
          knownTopics: getKnownTopics(),
          message: `Topic suggestion failed: ${error.message}`
        };
      }
    }
  },
  {
    name: 'get_notes',
    description: 'Read notes for a date and/or topic',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Date in YYYY-MM-DD format (optional)' },
        topic: { type: 'string', description: 'Topic filter (optional)' },
        open_blockers_only: { type: 'boolean', description: 'Return only blockers that are still open, ignoring the date filter' }
      },
      required: []
    },
    handler: async (args) => {
      try {
        let query = 'SELECT * FROM notes WHERE 1=1';
        const params = [];
        
        // An open blocker outlives the day it was raised, so this filter
        // deliberately ignores the date rather than intersecting with it.
        if (args.open_blockers_only) {
          query += ' AND is_blocker = 1 AND blocker_resolved_at IS NULL';
        } else if (args.date) {
          query += ' AND date = ?';
          params.push(args.date);
        }
        
        if (args.topic) {
          query += ' AND topic = ?';
          params.push(args.topic);
        }
        
        query += ' ORDER BY created_at DESC';
        
        const notes = db.prepare(query).all(...params);
        
        return {
          success: true,
          date: args.date || null,
          topic: args.topic || null,
          count: notes.length,
          notes: notes.map(n => ({
            id: n.id,
            note: n.note,
            topic: n.topic,
            title: n.title || null,
            ticket_id: n.ticket_id,
            date: n.date,
            created_at: n.created_at,
            updated_at: n.updated_at,
            one_note_page_id: n.one_note_page_id || null,
            one_note_synced_at: n.one_note_synced_at || null,
            is_blocker: Boolean(n.is_blocker),
            blocker_resolved_at: n.blocker_resolved_at || null,
            blocker_open: Boolean(n.is_blocker) && !n.blocker_resolved_at,
            // A note edited after its last backup is shown as out of sync.
            one_note_synced: Boolean(
              n.one_note_synced_at && !(n.updated_at > n.one_note_synced_at)
            )
          }))
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to fetch notes: ${error.message}`
        };
      }
    }
  },
  {
    name: 'create_note',
    description: 'Create a new note',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        note: { type: 'string', description: 'Note content' },
        topic: { type: 'string', description: 'Note category' },
        title: { type: 'string', description: 'Note title' },
        ticket_id: { type: 'string', description: 'Associated Jira ticket' },
        is_blocker: { type: 'boolean', description: 'Flag the note as a blocker to raise at stand-up' }
      },
      required: ['date', 'note']
    },
    handler: async (args) => {
      try {
        const ticketId = (args.ticket_id || '').trim();
        let topic;
        if (ticketId) {
          // A ticket-linked note is always filed under its ticket number, so
          // it groups onto that ticket's OneNote page.
          topic = ticketId;
        } else if (args.topic) {
          topic = args.topic;
        } else {
          // Never apply an AI category implicitly in the create path. The UI
          // can request a suggestion separately and ask the user to approve it.
          topic = 'General';
        }

        if (!ticketId && topic) db.prepare('INSERT OR IGNORE INTO note_topics (name) VALUES (?)').run(topic);
        const result = db.prepare(`
          INSERT INTO notes (date, note, topic, title, ticket_id, is_blocker)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(args.date, args.note, topic, args.title || null, ticketId || null, args.is_blocker ? 1 : 0);
        
        return {
          success: true,
          message: 'Note created',
          noteId: result.lastInsertRowid,
          topic
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to create note: ${error.message}`
        };
      }
    }
  },
  {
    name: 'update_note',
    description: 'Update an existing note',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Note ID' },
        note: { type: 'string', description: 'Updated note content' },
        topic: { type: 'string', description: 'Updated topic' },
        title: { type: 'string', description: 'Updated title' },
        ticket_id: { type: 'string', description: 'Associated Jira ticket' },
        is_blocker: { type: 'boolean', description: 'Flag or unflag the note as a blocker' }
      },
      required: ['id', 'note']
    },
    handler: async (args) => {
      try {
        const previous = db.prepare('SELECT topic FROM notes WHERE id = ?').get(args.id);
        if (!previous) return { success: false, message: 'No note found with ID ' + args.id };
        const previousTopic = previous.topic;
        const ticketId = (args.ticket_id || '').trim();
        // Linking a note to a ticket always wins over any topic the user
        // picked, so ticket notes stay grouped under their ticket number.
        const topic = ticketId || args.topic || null;

        if (!ticketId && topic) db.prepare('INSERT OR IGNORE INTO note_topics (name) VALUES (?)').run(topic);
        db.prepare(`
          UPDATE notes 
          SET note = ?, topic = ?, title = COALESCE(?, title), ticket_id = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(args.note, topic, args.title || null, ticketId || null, args.id);
        if (String(previousTopic || '').toLowerCase() !== String(topic || '').toLowerCase()) removeEmptyTopic(previousTopic);

        // Re-raising a blocker reopens it, so a recurring problem is not
        // hidden by the resolution stamp left from the last time it happened.
        if (args.is_blocker !== undefined) {
          db.prepare(
            'UPDATE notes SET is_blocker = ?, blocker_resolved_at = NULL WHERE id = ?'
          ).run(args.is_blocker ? 1 : 0, args.id);
        }
        
        return {
          success: true,
          message: 'Note updated',
          topic
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to update note: ${error.message}`
        };
      }
    }
  },
  {
    name: 'resolve_blocker',
    description: 'Mark a blocker note as resolved, or reopen it',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Note ID of the blocker' },
        resolved: { type: 'boolean', description: 'True to resolve (default), false to reopen' }
      },
      required: ['id']
    },
    handler: async (args) => {
      try {
        const row = db.prepare('SELECT id, is_blocker FROM notes WHERE id = ?').get(args.id);
        if (!row) return { success: false, message: `Note not found: ${args.id}` };
        if (!row.is_blocker) return { success: false, message: 'That note is not flagged as a blocker' };

        const resolved = args.resolved !== false;
        db.prepare(
          `UPDATE notes SET blocker_resolved_at = ${resolved ? 'CURRENT_TIMESTAMP' : 'NULL'} WHERE id = ?`
        ).run(args.id);

        return { success: true, message: resolved ? 'Blocker resolved' : 'Blocker reopened', resolved };
      } catch (error) {
        return { success: false, message: `Failed to update blocker: ${error.message}` };
      }
    }
  },
  {
    name: 'delete_note',
    description: 'Delete a note by ID',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Note ID' }
      },
      required: ['id']
    },
    handler: async (args) => {
      try {
        const existing = db.prepare('SELECT topic FROM notes WHERE id = ?').get(args.id);
        const result = db.prepare('DELETE FROM notes WHERE id = ?').run(args.id);
        
        if (result.changes === 0) {
          return {
            success: false,
            message: `No note found with ID ${args.id}`
          };
        }
        
        removeEmptyTopic(existing?.topic);
        return {
          success: true,
          message: 'Note deleted'
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to delete note: ${error.message}`
        };
      }
    }
  }
];
