/**
 * Planned work for the daily stand-up.
 *
 * At stand-up time the current day usually has nothing logged yet, so the
 * "today" half of the report would be empty exactly when it is needed. These
 * tools let a ticket be named as intended work without pretending it has been
 * worked on.
 *
 * Planned work lives in its own table and is never written to `daily_summary`,
 * so it cannot be picked up by submission and cannot reach Tempo. No time is
 * recorded against it - only the intent.
 */

import { db } from '../index.js';
import { localDateKey } from '../utils/dates.js';

const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';

/** Planned items for a date, oldest first so the list order is stable. */
export function plannedWorkFor(date) {
  return db.prepare(`
    SELECT id, date, ticket_id, summary, status
    FROM scrum_plan
    WHERE date = ?
    ORDER BY id ASC
  `).all(date);
}

export const tools = [
  {
    name: 'list_planned_work',
    description: 'List the tickets planned for a day (intent only - no time is logged and nothing is submitted to Tempo)',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', pattern: DATE_PATTERN, description: 'Defaults to the current local date' }
      },
      required: []
    },
    handler: async (args) => {
      try {
        const date = args.date || localDateKey();
        const planned = plannedWorkFor(date);
        return { success: true, date, planned, count: planned.length };
      } catch (error) {
        return { success: false, message: `Failed to list planned work: ${error.message}` };
      }
    }
  },
  {
    name: 'add_planned_work',
    description: 'Mark a Jira ticket as planned for a day. Records intent only - it creates no time entry and is never submitted to Tempo',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', pattern: DATE_PATTERN, description: 'Defaults to the current local date' },
        ticket_id: { type: 'string', description: 'Jira issue key, e.g. TIME-101' },
        summary: { type: 'string', description: 'Issue summary, shown in the report' },
        status: { type: 'string', description: 'Issue status, for display only' }
      },
      required: ['ticket_id']
    },
    handler: async (args) => {
      try {
        const ticketId = String(args.ticket_id || '').trim();
        if (!ticketId) return { success: false, message: 'A ticket_id is required' };

        const date = args.date || localDateKey();
        const existing = db.prepare(
          'SELECT id FROM scrum_plan WHERE date = ? AND ticket_id = ?'
        ).get(date, ticketId);

        // Re-adding the same ticket refreshes its summary rather than failing:
        // the user's intent is "this is planned", which is already true.
        db.prepare(`
          INSERT INTO scrum_plan (date, ticket_id, summary, status)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (date, ticket_id) DO UPDATE SET
            summary = excluded.summary,
            status = excluded.status
        `).run(date, ticketId, args.summary || null, args.status || null);

        const row = db.prepare(
          'SELECT id, date, ticket_id, summary, status FROM scrum_plan WHERE date = ? AND ticket_id = ?'
        ).get(date, ticketId);

        return {
          success: true,
          planned: row,
          plannedId: row?.id,
          created: !existing
        };
      } catch (error) {
        return { success: false, message: `Failed to add planned work: ${error.message}` };
      }
    }
  },
  {
    name: 'remove_planned_work',
    description: 'Remove a ticket from a day\'s planned work',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'The planned work row id' }
      },
      required: ['id']
    },
    handler: async (args) => {
      try {
        const result = db.prepare('DELETE FROM scrum_plan WHERE id = ?').run(args.id);
        if (result.changes === 0) return { success: false, message: `No planned work found with id ${args.id}` };
        return { success: true, removed: args.id };
      } catch (error) {
        return { success: false, message: `Failed to remove planned work: ${error.message}` };
      }
    }
  }
];
