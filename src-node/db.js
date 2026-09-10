import Database from 'better-sqlite3';
import { join } from 'path';
import os from 'os';
import { existsSync, mkdirSync } from 'fs';

export const APP_DATA_DIR = join(os.homedir(), '.timelogger-app');
const DB_PATH = join(APP_DATA_DIR, 'daily_summary.db');

if (!existsSync(APP_DATA_DIR)) {
  mkdirSync(APP_DATA_DIR, { recursive: true });
}

export const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');
// WAL lets the reads that back the UI run while a write is in flight, and is
// the recommended mode for a single-application local database. NORMAL is the
// matching durability setting: safe against process crashes, and only at risk
// from a power loss mid-write, which would cost at most the last transaction.
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS daily_summary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    ticket_id TEXT,
    name TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    duration_mins INTEGER,
    submitted INTEGER DEFAULT 0,
    from_calendar INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(date, name, start_time, end_time)
  );
  CREATE INDEX IF NOT EXISTS idx_daily_summary_date ON daily_summary(date);
  CREATE INDEX IF NOT EXISTS idx_daily_summary_ticket ON daily_summary(ticket_id);
  CREATE INDEX IF NOT EXISTS idx_daily_summary_submitted ON daily_summary(submitted);
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    ticket_id TEXT,
    note TEXT NOT NULL,
    topic TEXT,
    title TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_notes_date ON notes(date);
  CREATE INDEX IF NOT EXISTS idx_notes_topic ON notes(topic);
  CREATE INDEX IF NOT EXISTS idx_notes_ticket ON notes(ticket_id);
  CREATE TABLE IF NOT EXISTS submission_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    count INTEGER,
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_submission_history_date ON submission_history(date);
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS calendar_conflict_choices (
    date TEXT NOT NULL,
    event_id TEXT NOT NULL,
    attended INTEGER NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (date, event_id)
  );
  -- Work intended for the day but not yet done. Deliberately kept out of
  -- daily_summary: planned work carries no time and must never reach Tempo,
  -- and a separate table makes that a structural guarantee rather than a
  -- convention that a later query could quietly break.
  CREATE TABLE IF NOT EXISTS scrum_plan (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    ticket_id TEXT NOT NULL,
    summary TEXT,
    status TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (date, ticket_id)
  );
`);

const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);
const dailySummaryColumns = columns('daily_summary');
if (!dailySummaryColumns.includes('calendar_event_id')) db.exec('ALTER TABLE daily_summary ADD COLUMN calendar_event_id TEXT');
if (!dailySummaryColumns.includes('is_holiday')) db.exec('ALTER TABLE daily_summary ADD COLUMN is_holiday INTEGER DEFAULT 0');
if (!dailySummaryColumns.includes('tempo_worklog_id')) db.exec('ALTER TABLE daily_summary ADD COLUMN tempo_worklog_id TEXT');
db.exec('CREATE INDEX IF NOT EXISTS idx_daily_summary_tempo_worklog ON daily_summary(tempo_worklog_id)');
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_summary_calendar_event
    ON daily_summary(date, calendar_event_id)
    WHERE calendar_event_id IS NOT NULL;
`);

const notesColumns = columns('notes');
if (!notesColumns.includes('one_note_page_id')) db.exec('ALTER TABLE notes ADD COLUMN one_note_page_id TEXT');
if (!notesColumns.includes('one_note_synced_at')) db.exec('ALTER TABLE notes ADD COLUMN one_note_synced_at DATETIME');
if (!notesColumns.includes('title')) db.exec('ALTER TABLE notes ADD COLUMN title TEXT');
// A blocker is a note flagged as one. It stays open until it is explicitly
// resolved rather than expiring with its date, because a blocker raised on
// Tuesday is normally still a blocker at Wednesday's stand-up.
if (!notesColumns.includes('is_blocker')) db.exec('ALTER TABLE notes ADD COLUMN is_blocker INTEGER DEFAULT 0');
if (!notesColumns.includes('blocker_resolved_at')) db.exec('ALTER TABLE notes ADD COLUMN blocker_resolved_at DATETIME');
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_notes_open_blockers
    ON notes(is_blocker, blocker_resolved_at)
    WHERE is_blocker = 1 AND blocker_resolved_at IS NULL;
`);

const submissionHistoryColumns = columns('submission_history');
if (!submissionHistoryColumns.includes('status')) db.exec("ALTER TABLE submission_history ADD COLUMN status TEXT DEFAULT 'success'");
if (!submissionHistoryColumns.includes('failed_count')) db.exec('ALTER TABLE submission_history ADD COLUMN failed_count INTEGER DEFAULT 0');

const calendarConflictColumns = columns('calendar_conflict_choices');
// Overrides let a resolution say "left this one early" instead of only an
// all-or-nothing attended/declined choice, so a real half-and-half meeting
// pair can be logged as two adjoining, non-overlapping blocks.
if (!calendarConflictColumns.includes('start_time_override')) db.exec('ALTER TABLE calendar_conflict_choices ADD COLUMN start_time_override TEXT');
if (!calendarConflictColumns.includes('end_time_override')) db.exec('ALTER TABLE calendar_conflict_choices ADD COLUMN end_time_override TEXT');

db.exec(`
  UPDATE notes
  SET topic = ticket_id
  WHERE ticket_id IS NOT NULL AND TRIM(ticket_id) <> '' AND topic <> ticket_id
`);
db.exec(`
  UPDATE notes
  SET topic = TRIM(SUBSTR(topic, 7))
  WHERE topic LIKE 'Topic:%' AND TRIM(SUBSTR(topic, 7)) <> ''
`);

try {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'ollama_config'").get();
  if (row?.value) {
    const config = JSON.parse(row.value);
    if (config.model === 'llama2' && !config.modelDefaultReleased) {
      delete config.model;
      config.modelDefaultReleased = true;
      db.prepare("UPDATE settings SET value = ? WHERE key = 'ollama_config'").run(JSON.stringify(config));
    }
  }
} catch (error) {
  console.error('Failed to migrate Ollama model setting:', error.message);
}
