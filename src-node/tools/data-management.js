/**
 * Backup, restore and reset of the user's own data.
 *
 * The `settings` table is deliberately never exported. It holds the Jira API
 * token and the Microsoft refresh token, and a backup file is something people
 * copy onto shares and email to themselves - writing live credentials into one
 * turns a convenience feature into a credential leak. Backups therefore cover
 * only what the user actually created: entries, notes and submission history.
 *
 * For the same reason a restore never touches settings either, so importing a
 * colleague's backup cannot silently repoint your app at their Jira account.
 */

import { db, APP_DATA_DIR } from '../db.js';
import { statSync } from 'fs';
import { join } from 'path';

const EXPORT_FORMAT = 'timelogger-backup';
const EXPORT_VERSION = 1;

// The tables a backup covers, and the columns restored from one. Listing
// columns explicitly means a future schema addition cannot silently start
// exporting something sensitive, and an old backup missing a new column still
// imports cleanly.
const BACKUP_TABLES = {
  entries: {
    table: 'daily_summary',
    columns: [
      'date', 'ticket_id', 'name', 'start_time', 'end_time', 'duration_mins',
      'submitted', 'from_calendar', 'calendar_event_id', 'is_holiday',
      'created_at', 'updated_at'
    ]
  },
  notes: {
    table: 'notes',
    columns: [
      'date', 'ticket_id', 'note', 'topic', 'title',
      'one_note_page_id', 'one_note_synced_at', 'created_at', 'updated_at'
    ]
  },
  submissionHistory: {
    table: 'submission_history',
    columns: ['date', 'count', 'submitted_at', 'status', 'failed_count']
  }
};

// Cleared by a reset. `settings` is absent on purpose: wiping it would sign the
// user out of Microsoft and discard their Jira credentials, which is a
// different and much more destructive action than clearing logged time.
const CLEARABLE_TABLES = ['daily_summary', 'notes', 'submission_history', 'calendar_conflict_choices'];

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
};

const readTable = ({ table, columns }) =>
  db.prepare(`SELECT ${columns.join(', ')} FROM ${table}`).all();

/**
 * RFC 4180 escaping. Excel splits on a bare comma and breaks a row on a bare
 * newline, so a task name like "Standup, then triage" silently corrupts every
 * following column unless it is quoted.
 */
const csvCell = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const toCsv = (headers, rows) =>
  [headers.map(csvCell).join(','), ...rows.map(row => row.map(csvCell).join(','))].join('\r\n');

export const tools = [
  {
    name: 'get_database_info',
    description: 'Return the location and size of the local database, plus row counts',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: async () => {
      try {
        const path = join(APP_DATA_DIR, 'daily_summary.db');
        let bytes = 0;
        try {
          bytes = statSync(path).size;
        } catch {
          // A missing file just means nothing has been saved yet.
        }
        const count = (table) => db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total;
        return {
          success: true,
          path,
          size: formatBytes(bytes),
          sizeBytes: bytes,
          counts: {
            entries: count('daily_summary'),
            notes: count('notes'),
            submissionHistory: count('submission_history')
          }
        };
      } catch (error) {
        return { success: false, message: `Could not read database info: ${error.message}` };
      }
    }
  },
  {
    name: 'export_data',
    description: 'Export time entries, notes and submission history as JSON or CSV',
    parameters: {
      type: 'object',
      properties: { format: { type: 'string', enum: ['json', 'csv'] } },
      required: []
    },
    handler: async (args) => {
      try {
        const format = args?.format === 'csv' ? 'csv' : 'json';

        if (format === 'csv') {
          // A single sheet, so only the entries table - notes and history have
          // unrelated shapes and would need their own files.
          const { columns } = BACKUP_TABLES.entries;
          const rows = readTable(BACKUP_TABLES.entries);
          return {
            success: true,
            format,
            content: toCsv(columns, rows.map(row => columns.map(column => row[column]))),
            count: rows.length,
            suggestedName: `timelogger-entries-${new Date().toISOString().slice(0, 10)}.csv`
          };
        }

        const data = {};
        const counts = {};
        for (const [key, spec] of Object.entries(BACKUP_TABLES)) {
          data[key] = readTable(spec);
          counts[key] = data[key].length;
        }

        return {
          success: true,
          format,
          content: JSON.stringify({
            format: EXPORT_FORMAT,
            version: EXPORT_VERSION,
            exportedAt: new Date().toISOString(),
            ...data
          }, null, 2),
          counts,
          count: Object.values(counts).reduce((total, value) => total + value, 0),
          suggestedName: `timelogger-backup-${new Date().toISOString().slice(0, 10)}.json`
        };
      } catch (error) {
        return { success: false, message: `Export failed: ${error.message}` };
      }
    }
  },
  {
    name: 'import_data',
    description: 'Restore time entries, notes and submission history from a JSON backup',
    parameters: {
      type: 'object',
      properties: { content: { type: 'string' } },
      required: ['content']
    },
    handler: async (args) => {
      try {
        if (typeof args?.content !== 'string' || !args.content.trim()) {
          return { success: false, message: 'No backup content was provided.' };
        }

        let payload;
        try {
          payload = JSON.parse(args.content);
        } catch {
          return { success: false, message: 'That file is not valid JSON. Choose a backup exported by TimeLogger.' };
        }

        if (payload?.format !== EXPORT_FORMAT) {
          return { success: false, message: 'That file is not a TimeLogger backup.' };
        }
        if (Number(payload.version) > EXPORT_VERSION) {
          return { success: false, message: 'That backup was made by a newer version of TimeLogger. Update the app and try again.' };
        }

        const imported = {};
        const skipped = {};

        // Merged rather than replaced: an import is almost always "recover
        // what I lost", and wiping the current database first would turn a
        // wrong file chosen by accident into permanent data loss. INSERT OR
        // IGNORE leans on the existing UNIQUE constraints so re-importing the
        // same backup is a no-op instead of creating duplicates.
        const restore = db.transaction(() => {
          for (const [key, spec] of Object.entries(BACKUP_TABLES)) {
            const rows = Array.isArray(payload[key]) ? payload[key] : [];
            const statement = db.prepare(
              `INSERT OR IGNORE INTO ${spec.table} (${spec.columns.join(', ')})
               VALUES (${spec.columns.map(column => `@${column}`).join(', ')})`
            );

            let added = 0;
            let ignored = 0;
            for (const row of rows) {
              if (!row || typeof row !== 'object') {
                ignored++;
                continue;
              }
              // Normalised so a backup written before a column existed still
              // binds every parameter the statement expects.
              const values = Object.fromEntries(spec.columns.map(column => [column, row[column] ?? null]));
              const result = statement.run(values);
              if (result.changes > 0) added++;
              else ignored++;
            }
            imported[key] = added;
            skipped[key] = ignored;
          }
        });

        restore();

        const total = Object.values(imported).reduce((sum, value) => sum + value, 0);
        const duplicates = Object.values(skipped).reduce((sum, value) => sum + value, 0);
        return { success: true, imported, skipped, total, duplicates };
      } catch (error) {
        return { success: false, message: `Import failed: ${error.message}` };
      }
    }
  },
  {
    name: 'clear_all_data',
    description: 'Delete all time entries, notes and history. Settings and credentials are kept.',
    parameters: {
      type: 'object',
      properties: { confirm: { type: 'boolean' } },
      required: ['confirm']
    },
    handler: async (args) => {
      try {
        // The caller must say so explicitly, so a mistyped or empty argument
        // object can never wipe the database.
        if (args?.confirm !== true) {
          return { success: false, message: 'Confirmation is required to clear data.' };
        }

        const deleted = {};
        const wipe = db.transaction(() => {
          for (const table of CLEARABLE_TABLES) {
            deleted[table] = db.prepare(`DELETE FROM ${table}`).run().changes;
          }
        });
        wipe();

        // Reclaims the space rather than leaving the file at its old size,
        // which would make "Clear All Data" look like it had not worked.
        db.exec('VACUUM');

        return {
          success: true,
          deleted,
          total: Object.values(deleted).reduce((sum, value) => sum + value, 0)
        };
      } catch (error) {
        return { success: false, message: `Could not clear data: ${error.message}` };
      }
    }
  }
];
