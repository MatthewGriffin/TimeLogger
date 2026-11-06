/**
 * Puts text on one line for the log file. Error messages can contain values from
 * a request, and a line break in one could otherwise forge a log entry. The
 * pattern finds any whitespace other than spaces and tabs, which covers every
 * kind of line break, including Unicode's.
 */
export function singleLine(text) {
  return String(text).replace(/\s*[^\S \t]\s*/g, ' ').trim();
}
