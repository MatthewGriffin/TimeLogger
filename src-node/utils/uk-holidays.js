/**
 * England & Wales bank holidays, computed offline.
 *
 * These are derived rather than fetched so the app never needs the network to
 * decide whether a day was a working day. gov.uk publishes a JSON feed, but a
 * missed-days count that silently changes when the network is down is worse
 * than one that is computed from rules which have been stable for decades.
 *
 * Scotland and Northern Ireland have a different set; only England & Wales is
 * modelled here because that is what the app's working-week assumptions use.
 */

import { localDateKey, parseDateKey } from './dates.js';

/**
 * Easter Sunday for a given year via the anonymous Gregorian algorithm.
 * Good Friday and Easter Monday are the only movable feasts we need.
 */
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** The `nth` occurrence of `weekday` (0=Sun) in a month. */
function nthWeekdayOfMonth(year, month, weekday, nth) {
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + offset + (nth - 1) * 7);
}

/** The last occurrence of `weekday` (0=Sun) in a month. */
function lastWeekdayOfMonth(year, month, weekday) {
  const last = new Date(year, month + 1, 0);
  const offset = (last.getDay() - weekday + 7) % 7;
  return addDays(last, -offset);
}

/**
 * Move a fixed-date holiday off a weekend.
 *
 * When Christmas or New Year lands on a Saturday or Sunday the day off is
 * given on the following weekday. `taken` holds dates already claimed so that
 * Christmas and Boxing Day cannot both substitute onto the same Monday.
 */
function substituteDay(date, taken) {
  let candidate = date;
  while (candidate.getDay() === 0 || candidate.getDay() === 6 || taken.has(localDateKey(candidate))) {
    candidate = addDays(candidate, 1);
  }
  return candidate;
}

const cache = new Map();

/**
 * All England & Wales bank holidays in a year, as a Set of `YYYY-MM-DD` keys.
 */
export function ukBankHolidays(year) {
  const cached = cache.get(year);
  if (cached) return cached;

  const easter = easterSunday(year);
  const taken = new Set();
  const keys = new Set();

  // Movable and fixed-Monday holidays never fall on a weekend, so they are
  // added directly without substitution.
  const fixedMondays = [
    addDays(easter, -2), // Good Friday
    addDays(easter, 1), // Easter Monday
    nthWeekdayOfMonth(year, 4, 1, 1), // Early May, first Monday in May
    lastWeekdayOfMonth(year, 4, 1), // Spring, last Monday in May
    lastWeekdayOfMonth(year, 7, 1) // Summer, last Monday in August
  ];
  for (const date of fixedMondays) {
    const key = localDateKey(date);
    keys.add(key);
    taken.add(key);
  }

  // Order matters: Christmas Day claims its substitute before Boxing Day.
  const substituted = [
    new Date(year, 0, 1), // New Year's Day
    new Date(year, 11, 25), // Christmas Day
    new Date(year, 11, 26) // Boxing Day
  ];
  for (const date of substituted) {
    const key = localDateKey(substituteDay(date, taken));
    keys.add(key);
    taken.add(key);
  }

  cache.set(year, keys);
  return keys;
}

/** True if a `YYYY-MM-DD` key is an England & Wales bank holiday. */
export function isUkBankHoliday(dateKey) {
  const date = parseDateKey(dateKey);
  if (!date) return false;
  return ukBankHolidays(date.getFullYear()).has(dateKey);
}
