/**
 * Notes management tools
 */

import { db } from '../index.js';
import { ollamaClient } from '../api/ollama-client.js';

// The only built-in topic. Every other topic comes from actual use, so an
// empty category never lingers in the list.
const DEFAULT_NOTE_TOPICS = ['General'];

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
    return candidateKey.length >= 4 && (key.includes(candidateKey) || candidateKey.includes(key));
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
  const prompt = `Read this work note and name its main subject.

Note title: ${title || '(none)'}
Note content: ${body}

The subject is the product, system, technology, activity or area of work the note is mainly about.
It should be general enough that other notes about the same thing would share it.
Do not describe what happened in the note, and do not include names of people, ticket numbers or error messages.

Answer with 1 or 2 words and nothing else.`;

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
        topic: { type: 'string', description: 'Topic filter (optional)' }
      },
      required: []
    },
    handler: async (args) => {
      try {
        let query = 'SELECT * FROM notes WHERE 1=1';
        const params = [];
        
        if (args.date) {
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
    name: 'upsert_note',
    description: 'Create or update a note using the legacy note tool contract',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        date: { type: 'string' },
        note: { type: 'string' },
        topic: { type: 'string' },
        ticket_id: { type: 'string' }
      },
      required: ['date', 'note']
    },
    handler: async (args) => {
      if (args.id != null) {
        return tools.find(tool => tool.name === 'update_note').handler(args)
      }
      return tools.find(tool => tool.name === 'create_note').handler(args)
    }
  },
  {
    name: 'capture_prefixed_message',
    description: 'Capture a prefixed task or note message',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        date: { type: 'string' },
        topic: { type: 'string' },
        ticket_id: { type: 'string' }
      },
      required: ['message']
    },
    handler: async (args) => {
      const message = String(args.message || '').trim()
      const match = message.match(/^(note|task)\s+([\s\S]+)$/i)
      if (!match) return { success: false, message: 'Message must start with "note" or "task"' }
      const topic = match[1].toLowerCase() === 'task' ? (args.topic || 'General') : (args.topic || 'General')
      return tools.find(tool => tool.name === 'create_note').handler({
        date: args.date || new Date().toISOString().slice(0, 10),
        note: match[2].trim(),
        topic,
        ticket_id: args.ticket_id
      })
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
        ticket_id: { type: 'string', description: 'Associated Jira ticket' }
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
          // The topic picker was removed from the "new note" UI: the frontend
          // calls suggest_note_topic first and passes the (user-confirmed)
          // result here. If a caller skips that step, fall back to a direct
          // suggestion collapsed to a known topic, since a new topic must be
          // confirmed by a user before it can be created.
          const knownTopics = getKnownTopics();
          const suggestion = await suggestTopic(args.note, knownTopics, args.title);
          topic = suggestion.isNew ? 'General' : suggestion.topic;
        }

        const result = db.prepare(`
          INSERT INTO notes (date, note, topic, title, ticket_id)
          VALUES (?, ?, ?, ?, ?)
        `).run(args.date, args.note, topic, args.title || null, ticketId || null);
        
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
        ticket_id: { type: 'string', description: 'Associated Jira ticket' }
      },
      required: ['id', 'note']
    },
    handler: async (args) => {
      try {
        const ticketId = (args.ticket_id || '').trim();
        // Linking a note to a ticket always wins over any topic the user
        // picked, so ticket notes stay grouped under their ticket number.
        const topic = ticketId || args.topic || null;

        db.prepare(`
          UPDATE notes 
          SET note = ?, topic = ?, title = COALESCE(?, title), ticket_id = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(args.note, topic, args.title || null, ticketId || null, args.id);
        
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
        const result = db.prepare('DELETE FROM notes WHERE id = ?').run(args.id);
        
        if (result.changes === 0) {
          return {
            success: false,
            message: `No note found with ID ${args.id}`
          };
        }
        
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
