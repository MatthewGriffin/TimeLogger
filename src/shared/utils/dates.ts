/**
 * Local calendar date helpers.
 *
 * Every date the app stores is a local calendar day ("what day was it for the
 * user"), never an instant. `toISOString()` converts to UTC first, so anyone
 * west of UTC gets the previous day for most of the evening - which silently
 * files time against the wrong date. These helpers build the string from the
 * local parts instead.
 *
 * Mirrors `src-node/utils/dates.js` so both halves of the app agree on which
 * day a timestamp belongs to.
 */

/** Format a Date as a local `YYYY-MM-DD` key. */
export const localDate = (date: Date = new Date()): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

/** Format a Date as a local `HH:MM` clock time. */
export const localTime = (date: Date = new Date()): string =>
  `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`

/** Parse a `YYYY-MM-DD` key into a local midnight Date, or null if malformed. */
export const parseDateKey = (value: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return null
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Start of the week containing `date`, as a local midnight Date.
 *
 * Weeks always run Monday to Sunday. The working week is the unit users think
 * in and submit against, so a Sunday start would split it across two weeks.
 * `getDay()` is 0 for Sunday, which belongs to the week that began 6 days
 * earlier, hence the `+ 6` rotation.
 */
export const startOfWeek = (date: Date = new Date()): Date => {
  const monday = new Date(date)
  monday.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  monday.setHours(0, 0, 0, 0)
  return monday
}
