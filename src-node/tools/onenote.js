/**
 * OneNote integration tools
 */

import { graphClient } from '../api/graph-client.js';
import { db } from '../index.js';

/**
 * Note text is user-authored and goes straight into a OneNote page, so it has
 * to be escaped or a stray angle bracket silently corrupts the document.
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildNotesBodyHtml(notes) {
  const rows = notes.map(note => {
    // The old meta column is degenerate now that ticket-linked notes are
    // filed under their ticket number: a ticket page would repeat that
    // number on every row, and a topic page never has a ticket. The note
    // title is the useful per-row detail instead.
    const derivedTitle = String(note.note || '').split(/\r?\n/, 1)[0].slice(0, 80);
    const meta = escapeHtml(note.title || derivedTitle || '-');
    const body = escapeHtml(note.note).replace(/\r?\n/g, '<br/>');
    return `<tr><td>${escapeHtml(note.date || '')}</td><td>${meta}</td><td>${body}</td></tr>`;
  }).join('');

  return [
    '<div>',
    `<p>Backed up from TimeLogger on ${escapeHtml(new Date().toLocaleString())}. ${notes.length} note(s).</p>`,
    '<table border="1">',
    '<tr><th>Date</th><th>Title</th><th>Note</th></tr>',
    rows,
    '</table>',
    '</div>'
  ].join('');
}

function buildNotesPageHtml(title, notes) {
  return [
    '<!DOCTYPE html>',
    '<html><head>',
    `<title>${escapeHtml(title)}</title>`,
    '<meta charset="utf-8" />',
    '</head><body>',
    buildNotesBodyHtml(notes),
    '</body></html>'
  ].join('');
}

export const tools = [
  {
    name: 'onenote_list_notebooks',
    description: 'List OneNote notebooks and sections available to user',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    },
    handler: async (args) => {
      try {
        // Initialize graph client
        const initialized = await graphClient.initialize();
        if (!initialized) {
          return {
            success: false,
            message: 'Microsoft account not connected. Configure Microsoft authentication first.',
            textResultForLlm: 'Graph API not configured. Run setup wizard to authenticate.',
            resultType: 'failure'
          };
        }

        // Fetch notebooks
        const notebooks = await graphClient.getNotebooks();

        if (notebooks.length === 0) {
          return {
            notebooks: [],
            count: 0,
            message: 'No OneNote notebooks found for this account'
          };
        }

        // Fetch sections for each notebook
        const notebooksWithSections = await Promise.all(
          notebooks.map(async (notebook) => {
            try {
              const sections = await graphClient.getNotebookSections(notebook.id);
              return {
                ...notebook,
                sections: sections
              };
            } catch (error) {
              return {
                ...notebook,
                sections: [],
                error: error.message
              };
            }
          })
        );

        return {
          notebooks: notebooksWithSections,
          count: notebooks.length,
          message: `Found ${notebooks.length} notebook(s) with sections`
        };
      } catch (error) {
        // success/message are required here: the frontend treats a result
        // without them as an empty notebook list and hides the real cause.
        return {
          success: false,
          message: `Failed to fetch notebooks: ${error.message}`,
          textResultForLlm: `Failed to fetch notebooks: ${error.message}`,
          resultType: 'failure'
        };
      }
    }
  },
  {
    name: 'onenote_create_page',
    description: 'Create a new OneNote page in a section with HTML content',
    parameters: {
      type: 'object',
      properties: {
        sectionId: { type: 'string', description: 'Section ID where to create page' },
        title: { type: 'string', description: 'Page title' },
        content: { type: 'string', description: 'Page content (text or HTML)' }
      },
      required: ['sectionId', 'title', 'content']
    },
    handler: async (args) => {
      try {
        // Validate inputs
        if (!args.sectionId || !args.title || !args.content) {
          throw new Error('Missing required parameters: sectionId, title, content');
        }

        // Initialize graph client
        const initialized = await graphClient.initialize();
        if (!initialized) {
          return {
            textResultForLlm: 'Graph API not configured. Run setup wizard.',
            resultType: 'failure'
          };
        }

        // Convert content to HTML if plain text
        let htmlContent = args.content;
        if (!args.content.includes('<html') && !args.content.includes('<!DOCTYPE')) {
          // Treat as plain text, escape and wrap in HTML
          htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>${
            args.content.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')
          }</body></html>`;
        }

        // Create page
        const result = await graphClient.createOnenoteePage(
          args.sectionId,
          args.title,
          htmlContent
        );

        return {
          success: true,
          message: `✅ Page created: ${args.title}`,
          pageId: result.id,
          url: result.links?.oneNoteWebUrl?.href
        };
      } catch (error) {
        return {
          textResultForLlm: `Failed to create OneNote page: ${error.message}`,
          resultType: 'failure'
        };
      }
    }
  },
  {
    name: 'onenote_update_page',
    description: 'Update content of an existing OneNote page',
    parameters: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: 'Page ID to update' },
        content: { type: 'string', description: 'New content (text or HTML)' }
      },
      required: ['pageId', 'content']
    },
    handler: async (args) => {
      try {
        // Validate inputs
        if (!args.pageId || !args.content) {
          throw new Error('Missing required parameters: pageId, content');
        }

        // Initialize graph client
        const initialized = await graphClient.initialize();
        if (!initialized) {
          return {
            textResultForLlm: 'Graph API not configured. Run setup wizard.',
            resultType: 'failure'
          };
        }

        // Convert content to HTML if plain text
        let htmlContent = args.content;
        if (!args.content.includes('<html') && !args.content.includes('<!DOCTYPE')) {
          htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>${
            args.content.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')
          }</body></html>`;
        }

        // Update page
        await graphClient.updateOnenotePage(args.pageId, htmlContent);

        return {
          success: true,
          message: `✅ Page updated: ${args.pageId}`
        };
      } catch (error) {
        return {
          textResultForLlm: `Failed to update OneNote page: ${error.message}`,
          resultType: 'failure'
        };
      }
    }
  },
  {
    name: 'onenote_sync_notes',
    description: 'Back up notes to OneNote, routing ticket-linked notes and general notes to their own configured sections',
    parameters: {
      type: 'object',
      properties: {
        noteIds: {
          type: 'array',
          items: { type: 'number' },
          description: 'Specific note ids to sync; omit to sync everything created or changed since the last run'
        },
        force: {
          type: 'boolean',
          description: 'Re-sync every note even if it is already up to date'
        }
      },
      required: []
    },
    handler: async (args) => {
      try {
        const configRow = db.prepare("SELECT value FROM settings WHERE key = 'onenote_config'").get();
        let config = {};
        try {
          config = configRow ? JSON.parse(configRow.value) : {};
        } catch {
          config = {};
        }

        if (!config.syncEnabled) {
          return {
            success: false,
            synced: 0,
            message: 'OneNote sync is disabled. Enable it in Settings → OneNote.'
          };
        }

        const generalSectionId = (config.sectionId || '').trim();
        // Falling back keeps a single-section setup working rather than
        // silently dropping every ticket note.
        const ticketSectionId = (config.ticketSectionId || '').trim() || generalSectionId;

        if (!generalSectionId && !ticketSectionId) {
          return {
            success: false,
            synced: 0,
            message: 'No OneNote section selected. Choose sections in Settings → OneNote.'
          };
        }

        const initialized = await graphClient.initialize();
        if (!initialized) {
          return {
            success: false,
            synced: 0,
            message: 'Microsoft account not connected. Sign in on the Microsoft settings tab first.'
          };
        }

        // Work out which notes need writing. A note is stale when it has never
        // been synced or has been edited since it last was.
        let candidates;
        if (Array.isArray(args.noteIds) && args.noteIds.length > 0) {
          const placeholders = args.noteIds.map(() => '?').join(',');
          candidates = db.prepare(
            `SELECT * FROM notes WHERE id IN (${placeholders})`
          ).all(...args.noteIds);
        } else if (args.force) {
          candidates = db.prepare('SELECT * FROM notes').all();
        } else {
          candidates = db.prepare(`
            SELECT * FROM notes
            WHERE one_note_synced_at IS NULL
               OR updated_at > one_note_synced_at
          `).all();
        }

        if (candidates.length === 0) {
          return {
            success: true,
            synced: 0,
            pages: 0,
            skipped: 0,
            results: [],
            message: 'Everything is already backed up to OneNote'
          };
        }

        const hasTicket = note => typeof note.ticket_id === 'string' && note.ticket_id.trim() !== '';

        // Pages are per group, so a stale note pulls in its whole group; the
        // page is rewritten as a complete document rather than appended to.
        const groups = new Map();
        for (const note of candidates) {
          const key = hasTicket(note)
            ? `ticket:${note.ticket_id.trim()}`
            : `topic:${note.topic || 'General'}`;
          if (!groups.has(key)) groups.set(key, key);
        }

        const allNotes = db.prepare('SELECT * FROM notes ORDER BY date ASC, created_at ASC').all();
        const membersOf = key => allNotes.filter(note => {
          const noteKey = hasTicket(note)
            ? `ticket:${note.ticket_id.trim()}`
            : `topic:${note.topic || 'General'}`;
          return noteKey === key;
        });

        const markSynced = db.prepare(
          'UPDATE notes SET one_note_page_id = ?, one_note_synced_at = CURRENT_TIMESTAMP WHERE id = ?'
        );

        const results = [];
        let syncedNotes = 0;

        for (const key of groups.keys()) {
          const isTicket = key.startsWith('ticket:');
          const label = key.slice(key.indexOf(':') + 1);
          const sectionId = isTicket ? ticketSectionId : generalSectionId;
          const members = membersOf(key);

          if (!sectionId) {
            results.push({
              group: label,
              kind: isTicket ? 'ticket' : 'topic',
              noteCount: members.length,
              success: false,
              error: isTicket
                ? 'No ticket-notes section configured'
                : 'No general-notes section configured'
            });
            continue;
          }

          const title = isTicket ? `${label} — Notes` : `${label} Notes`;
          const html = buildNotesPageHtml(title, members);
          const existingPageId = members.find(note => note.one_note_page_id)?.one_note_page_id || null;

          try {
            let pageId = existingPageId;
            if (pageId) {
              try {
                await graphClient.updateOnenotePage(pageId, buildNotesBodyHtml(members));
              } catch (updateError) {
                // The page may have been deleted in OneNote since we recorded
                // it; fall back to creating a fresh one rather than failing.
                if (/404|not found/i.test(updateError.message)) {
                  const created = await graphClient.createOnenoteePage(sectionId, title, html);
                  pageId = created?.id || null;
                } else {
                  throw updateError;
                }
              }
            } else {
              const created = await graphClient.createOnenoteePage(sectionId, title, html);
              pageId = created?.id || null;
            }

            const applyMarks = db.transaction(() => {
              for (const note of members) markSynced.run(pageId, note.id);
            });
            applyMarks();

            syncedNotes += members.length;
            results.push({
              group: label,
              kind: isTicket ? 'ticket' : 'topic',
              noteCount: members.length,
              pageId,
              action: existingPageId ? 'updated' : 'created',
              success: true
            });
          } catch (error) {
            results.push({
              group: label,
              kind: isTicket ? 'ticket' : 'topic',
              noteCount: members.length,
              success: false,
              error: error.message
            });
          }
        }

        const okPages = results.filter(result => result.success);
        const failed = results.filter(result => !result.success);

        return {
          success: failed.length === 0,
          synced: syncedNotes,
          pages: okPages.length,
          failedPages: failed.length,
          results,
          message: failed.length === 0
            ? `Backed up ${syncedNotes} note(s) across ${okPages.length} OneNote page(s)`
            : `Backed up ${syncedNotes} note(s) across ${okPages.length} page(s); ${failed.length} failed: ${failed.map(f => `${f.group} (${f.error})`).join(', ')}`
        };
      } catch (error) {
        return {
          success: false,
          synced: 0,
          message: `Failed to sync notes to OneNote: ${error.message}`
        };
      }
    }
  }
];
