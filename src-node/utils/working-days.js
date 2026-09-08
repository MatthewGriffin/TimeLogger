/**
 * Working-day navigation.
 *
 * Lives apart from `dates.js` because it needs the bank-holiday calendar, and
 * `uk-holidays.js` already imports `dates.js` - putting this there would close
 * an import cycle.
 */

import { localDateKey, isWeekend, parseDateKey } from './dates.js';
import { isUkBankHoliday } from './uk-holidays.js';

/** True when a `YYYY-MM-DD` key is a normal working day. */
export function isWorkingDay(dateKey) {
  const date = parseDateKey(dateKey);
  if (!date) return false;
  return !isWeekend(date) && !isUkBankHoliday(dateKey);
}

/**
 * The working day before `dateKey`.
 *
 * On a Monday this is the previous Friday, which is what "what did you do
 * yesterday" means at a Monday stand-up. Bank holidays are skipped for the
 * same reason. The search is bounded so a malformed calendar cannot spin.
 */
export function previousWorkingDay(dateKey, { maxLookBack = 14 } = {}) {
  const start = parseDateKey(dateKey);
  if (!start) return null;

  const cursor = new Date(start.getTime());
  for (let i = 0; i < maxLookBack; i += 1) {
    cursor.setDate(cursor.getDate() - 1);
    const key = localDateKey(cursor);
    if (isWorkingDay(key)) return key;
  }
  return null;
}
