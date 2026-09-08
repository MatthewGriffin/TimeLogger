import { db } from '../index.js';

/**
 * Describe why a single worklog was rejected by Tempo.
 *
 * Tempo refuses worklogs dated beyond the future-logging window configured on
 * the account. That is a "not yet" rather than a fault: the entry is a real
 * future booking that will post fine nearer the time. Marking it lets callers
 * report it apart from genuine failures, and lets a bulk run stop hammering
 * Tempo with later dates that are certain to be refused for the same reason.
 */
/**
 * How many days ahead of today a date falls, in whole local days.
 */
export function daysAhead(date, today = new Date()) {
  const [y, m, d] = date.split('-').map(Number);
  const target = Date.UTC(y, m - 1, d);
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - start) / 86400000);
}

/**
 * Narrow the remembered future-logging window from what Tempo just did.
 *
 * The window is configured per Tempo account, so it is learned from Tempo's
 * own accept/reject decisions rather than hardcoded. A rejection proves the
 * limit is below that offset; an acceptance proves it reaches at least that
 * far. Acceptance widens the window so a limit later raised in Tempo, or a
 * stale reading, corrects itself instead of hiding entries forever.
 */
export function learnFutureLimit(current, { rejectedAt = null, acceptedAt = null } = {}) {
  let limit = typeof current === 'number' && Number.isFinite(current) ? current : null;
  if (rejectedAt !== null) {
    limit = limit === null ? rejectedAt - 1 : Math.min(limit, rejectedAt - 1);
  }
  if (acceptedAt !== null && limit !== null && acceptedAt > limit) {
    limit = acceptedAt;
  }
  // A negative window would mean today itself is unloggable, which Tempo does
  // not do; treat that as an unusable reading rather than blocking everything.
  return limit !== null && limit >= 0 ? limit : null;
}

export function readFutureLimit() {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('tempo_future_limit_days');
    const parsed = row ? Number(row.value) : NaN;
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeFutureLimit(limit) {
  if (limit === null) return;
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    .run('tempo_future_limit_days', String(limit));
}

/**
 * The local date this many days from today, as YYYY-MM-DD.
 */
export function isoDaysFromToday(offset, today = new Date()) {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function classifyWorklogFailure(message) {
  const text = message || 'Failed';
  const futureLimited = /too far into the future/i.test(text);
  return {
    futureLimited,
    reason: futureLimited
      ? 'Tempo does not accept worklogs dated this far ahead yet'
      : text
  };
}
