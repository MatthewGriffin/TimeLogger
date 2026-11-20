/**
 * How far through the sprint you are, and how much support time it has taken.
 *
 * One story point is one day's work, so story points turn into hours using the
 * length of the working day set in Settings.
 */
import { db } from '../index.js';
import { localDateKey, minutesOfDay, parseDateKey } from '../utils/dates.js';
import { isWorkingDay } from '../utils/working-days.js';
import { resolveTempoToken, resolveJiraCredentials, getCurrentAccount } from './jira-tempo-auth.js';
import { fetchTempoWorklogs } from './jira-tempo-worklogs.js';
import { ruleBasedActivityType } from './jira-tempo-activity.js';

/** Sprints usually run two weeks from the day they start. */
export const DEFAULT_SPRINT_DAYS = 14;

const toMinutes = (time, fallback) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(time || ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : fallback;
};

function readAppConfig() {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'app_config'").get();
    return row?.value ? JSON.parse(row.value) || {} : {};
  } catch { return {}; }
}

/** The working day: start, end, and the hours in it once lunch is taken out. */
export function workdayHours(config = readAppConfig()) {
  const start = toMinutes(config.workday?.startTime, 9 * 60);
  const end = toMinutes(config.workday?.endTime, 17 * 60);
  let minutes = Math.max(0, end - start);
  const lunch = config.lunch;
  if (lunch?.enabled) {
    minutes -= Math.max(0, toMinutes(lunch.endTime, 0) - toMinutes(lunch.startTime, 0));
  }
  return { startMinute: start, endMinute: end, minutes: minutes > 0 ? minutes : 7.5 * 60 };
}

function addDays(key, days) {
  const date = parseDateKey(key);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

function workingDaysBetween(from, to) {
  const days = [];
  for (let key = from; key <= to; key = addDays(key, 1)) {
    if (isWorkingDay(key)) days.push(key);
    if (days.length > 400) break; // a mistyped end date must not loop for years
  }
  return days;
}

/**
 * The sprint's dates and how much of it has gone, in working days.
 *
 * Today counts for the part of the working day that has passed, so the
 * expected progress moves through the day rather than jumping at midnight.
 */
export function sprintTimeline(startedAt, endsOn, now = new Date(), workday = workdayHours()) {
  if (!startedAt) return null;
  const startDate = localDateKey(new Date(startedAt));
  const customEnd = parseDateKey(endsOn) ? endsOn : '';
  // Two weeks from the start covers the start day itself, so the default ends the day before.
  const endDate = customEnd && customEnd >= startDate ? customEnd : addDays(startDate, DEFAULT_SPRINT_DAYS - 1);
  const today = localDateKey(now);
  const days = workingDaysBetween(startDate, endDate);
  const finished = days.filter(day => day < today).length;
  const dayFraction = Math.min(1, Math.max(0, (minutesOfDay(now) - workday.startMinute) / Math.max(1, workday.endMinute - workday.startMinute)));
  const elapsed = Math.min(days.length, finished + (days.includes(today) ? dayFraction : 0));
  return {
    startDate,
    endDate,
    endIsDefault: !(customEnd && customEnd >= startDate),
    workingDays: days.length,
    elapsedDays: Math.round(elapsed * 100) / 100,
    daysLeft: Math.max(0, Math.round((days.length - elapsed) * 100) / 100),
    fraction: days.length ? elapsed / days.length : 0
  };
}

/** Minutes of unsent local entries that read as support work, as they would at submission. */
export function localSupportMinutes(from, to) {
  const values = [{ id: 'fix', name: 'Support-Fix' }, { id: 'investigation', name: 'Support-Investigation' }];
  const rows = db.prepare(`
    SELECT name, duration_mins FROM daily_summary
    WHERE date >= ? AND date <= ? AND COALESCE(submitted, 0) = 0
      AND COALESCE(from_calendar, 0) = 0 AND COALESCE(is_lunch, 0) = 0 AND COALESCE(is_holiday, 0) = 0
  `).all(from, to);
  return rows.reduce((total, row) => total + (ruleBasedActivityType(row.name, values) ? row.duration_mins || 0 : 0), 0);
}

const SUPPORT_CACHE_MS = 5 * 60 * 1000;
let supportCache = null;

/**
 * Time spent on support so far: worklogs already in Tempo whose activity type
 * is a support one (Support-Fix, Support-Investigation), plus entries not sent
 * yet that would be given one. Without Tempo only the unsent entries count,
 * and `tempoError` says why.
 */
export async function supportSpent(from, to) {
  const key = `${from}|${to}`;
  if (supportCache?.key === key && Date.now() - supportCache.at < SUPPORT_CACHE_MS) return supportCache.value;
  const localMins = localSupportMinutes(from, to);
  let tempoMins = 0;
  let tempoError = '';
  try {
    const credentials = resolveJiraCredentials({});
    const token = resolveTempoToken({});
    const account = await getCurrentAccount(credentials);
    const worklogs = await fetchTempoWorklogs(credentials, token, account.accountId, from, to);
    tempoMins = worklogs
      .filter(worklog => /support/i.test(worklog.activityTypeName || ''))
      .reduce((total, worklog) => total + (worklog.durationMins || 0), 0);
  } catch (error) {
    tempoError = error.message;
  }
  const value = { spentMins: tempoMins + localMins, tempoMins, localMins, tempoError };
  // A failed Tempo read isn't kept, so the next look tries again.
  if (!tempoError) supportCache = { key, at: Date.now(), value };
  return value;
}

export const clearSupportCache = () => { supportCache = null; };
