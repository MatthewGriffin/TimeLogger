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
import { ruleBasedActivityType, ticketSupportKind, fetchTicketInfo } from './jira-tempo-activity.js';

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

/**
 * The story points that should be done by now.
 *
 * Time given to support can't also go into the planned points, so the sprint's
 * working days are split: support takes the days kept for it (one point is one
 * day), or the days it has actually taken if that is more, and the planned
 * points are spread over the rest. Of that, the time gone so far counts only
 * what was not spent on support. With no support points set, the planned points
 * simply follow the working days that have gone.
 */
export function expectedPoints({ planned, timeline, supportPoints = null, supportSpentMins = 0, workdayMinutes = 450 }) {
  if (!timeline || !(planned > 0)) return 0;
  if (supportPoints === null || supportPoints === undefined) return planned * timeline.fraction;
  const spentDays = Math.max(0, supportSpentMins) / Math.max(1, workdayMinutes);
  const devDays = Math.max(0, timeline.workingDays - Math.max(supportPoints, spentDays));
  if (devDays <= 0) return planned;
  const devDaysGone = Math.min(devDays, Math.max(0, timeline.elapsedDays - spentDays));
  return planned * (devDaysGone / devDays);
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

const UNSENT_FILTER = `date >= ? AND date <= ? AND COALESCE(submitted, 0) = 0
  AND COALESCE(from_calendar, 0) = 0 AND COALESCE(is_lunch, 0) = 0 AND COALESCE(is_holiday, 0) = 0`;

/**
 * Minutes of unsent local entries that read as support work, as they would at
 * submission: by the entry's name, or by its ticket when that is a support one
 * (`ticketInfo` maps ticket keys to what Jira says about them).
 */
export function localSupportMinutes(from, to, ticketInfo = new Map()) {
  const values = ['Code Review', 'Meeting', 'QA', 'N/A', 'Dev', 'Support-Fix', 'Support-Investigation'].map(name => ({ id: name, name }));
  const rows = db.prepare(`SELECT name, ticket_id, duration_mins FROM daily_summary WHERE ${UNSENT_FILTER}`).all(from, to);
  return rows.reduce((total, row) => {
    const ruled = ruleBasedActivityType(row.name, values);
    const keepsName = ruled && ['Code Review', 'Meeting', 'QA', 'N/A'].includes(ruled.name);
    const info = ticketInfo.get(String(row.ticket_id || '').trim().toUpperCase());
    const isSupport = keepsName ? false : (ticketSupportKind(info) !== null || /^Support/.test(ruled?.name || ''));
    return total + (isSupport ? row.duration_mins || 0 : 0);
  }, 0);
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
  let ticketInfo = new Map();
  try {
    const keys = db.prepare(`SELECT DISTINCT ticket_id FROM daily_summary WHERE ${UNSENT_FILTER} AND ticket_id IS NOT NULL`).all(from, to).map(row => row.ticket_id);
    if (keys.length) ticketInfo = await fetchTicketInfo(resolveJiraCredentials({}), keys);
  } catch { /* without Jira, entries are judged by their names */ }
  const localMins = localSupportMinutes(from, to, ticketInfo);
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
