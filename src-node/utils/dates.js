/**
 * Local calendar date helpers.
 *
 * Every date the app stores is a local calendar day ("what day was it for the
 * user"), never an instant. `toISOString()` converts to UTC first, so anyone
 * west of UTC gets the previous day for most of the evening - which silently
 * files time against the wrong date. These helpers build the string from the
 * local parts instead.
 */

/** Format a Date as a local `YYYY-MM-DD` key. */
export function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Minutes since local midnight. */
export function minutesOfDay(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes();
}

/** True for Saturday and Sunday in the local timezone. */
export function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/** Parse a `YYYY-MM-DD` key into a local midnight Date, or null if malformed. */
export function parseDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}
