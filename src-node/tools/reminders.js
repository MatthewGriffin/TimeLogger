/**
 * Tempo submission reminders.
 *
 * The decision of whether a reminder is due lives here rather than in the UI
 * so it is evaluated against the database, survives the window being closed
 * to the tray, and cannot fire twice from two places.
 *
 * Everything is a local SQLite read - no Tempo API calls - so the periodic
 * check costs nothing and can never slow the app down or block on the
 * network.
 */

import { db } from '../index.js';
import { localDateKey as localDate, minutesOfDay } from '../utils/dates.js';

const CONFIG_KEY = 'notifications_config';
const LAST_SHOWN_KEY = 'tempo_reminder_last_shown';

export const DEFAULT_TEMPO_REMINDER = {
  enabled: false,
  time: '16:30',
  days: 'weekdays'
};

export function readNotificationsConfig() {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(CONFIG_KEY);
    const saved = row?.value ? JSON.parse(row.value) : {};
    return {
      enabled: saved.enabled !== false,
      submissionAlerts: saved.submissionAlerts !== false,
      tempoReminder: { ...DEFAULT_TEMPO_REMINDER, ...(saved.tempoReminder || {}) }
    };
  } catch {
    return { enabled: true, submissionAlerts: true, tempoReminder: { ...DEFAULT_TEMPO_REMINDER } };
  }
}

export function writeNotificationsConfig(config) {
  const current = readNotificationsConfig();
  const next = {
    enabled: config.enabled !== undefined ? Boolean(config.enabled) : current.enabled,
    submissionAlerts: config.submissionAlerts !== undefined ? Boolean(config.submissionAlerts) : current.submissionAlerts,
    tempoReminder: { ...current.tempoReminder, ...(config.tempoReminder || {}) }
  };
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(CONFIG_KEY, JSON.stringify(next));
  return next;
}

/**
 * Parse "HH:MM" into minutes since midnight, rejecting anything malformed so
 * a bad value cannot make the reminder fire at an unexpected time.
 */
function parseTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function isDueDay(days, date) {
  if (days === 'everyday') return true;
  const day = date.getDay();
  return day >= 1 && day <= 5;
}

function readLastShown() {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(LAST_SHOWN_KEY);
    return row?.value || null;
  } catch {
    return null;
  }
}

function writeLastShown(date) {
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(LAST_SHOWN_KEY, date);
}

function unsubmittedForDate(date) {
  const row = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(duration_mins), 0) AS minutes
    FROM daily_summary
    WHERE date = ? AND (submitted IS NULL OR submitted = 0)
  `).get(date);
  return { count: row?.count || 0, minutes: row?.minutes || 0 };
}

export const tools = [
  {
    name: 'check_tempo_reminder',
    description: 'Decide whether the Tempo submission reminder is due now, marking it shown so it fires only once per day',
    parameters: {
      type: 'object',
      properties: {
        peek: { type: 'boolean', description: 'Evaluate without marking the reminder as shown' }
      }
    },
    handler: async (args) => {
      const config = readNotificationsConfig();
      const reminder = config.tempoReminder;
      const now = new Date();
      const today = localDate(now);

      const idle = (reason) => ({ success: true, shouldNotify: false, reason, date: today });

      if (!config.enabled) return idle('notifications_disabled');
      if (!reminder.enabled) return idle('reminder_disabled');
      if (!isDueDay(reminder.days, now)) return idle('not_a_reminder_day');

      const dueAt = parseTime(reminder.time);
      if (dueAt === null) return idle('invalid_time');
      if (minutesOfDay(now) < dueAt) return idle('too_early');

      // Once per day. Checked before the entry count so that submitting after
      // a reminder cannot re-arm it later the same day.
      if (readLastShown() === today) return idle('already_shown_today');

      const { count, minutes } = unsubmittedForDate(today);
      // Nothing outstanding is not "done for the day" - work logged later
      // still deserves a reminder, so this does not consume today's slot.
      if (count === 0) return idle('nothing_to_submit');

      if (!args?.peek) writeLastShown(today);

      return {
        success: true,
        shouldNotify: true,
        date: today,
        unsubmittedCount: count,
        unsubmittedMinutes: minutes
      };
    }
  },
  {
    name: 'reset_tempo_reminder',
    description: 'Clear the record of today\'s reminder so it can fire again (used when settings change)',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
      db.prepare('DELETE FROM settings WHERE key = ?').run(LAST_SHOWN_KEY);
      return { success: true };
    }
  }
];
