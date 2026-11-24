/**
 * Whether time could still be logged against a ticket in this status.
 *
 * Once development is finished and the ticket is with QA, release or anyone
 * else, there is nothing more to log, so those statuses are left out of ticket
 * lookups. The latest status that still shows is Ready for QA Demo. Resolved is
 * the exception: it means the ticket was investigated with no code change, and
 * that work still needs logging.
 */
const AFTER_DEVELOPMENT = new RegExp([
  'agile qa',
  'ready for qa(?! demo)',
  'qa onsite',
  'integration testing',
  'all dev done',
  'ready for remote',
  'agile test',
  'in (qa|test)',
  'awaiting release',
  'pending release',
  'release to',
  'ready for (uat|release|deployment)',
  'parked',
  'removed',
  'abandoned',
  'closed',
  '^done$',
  'sub-task done'
].join('|'), 'i')

export function isLoggableStatus(status: string | null | undefined): boolean {
  const name = String(status ?? '').trim()
  if (!name) return true
  if (/^resolved/i.test(name)) return true
  return !AFTER_DEVELOPMENT.test(name)
}

/** A ticket key typed on its own, such as WLSVC-311: asking for it by name always shows it. */
export const isTicketKey = (text: string): boolean => /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(text.trim())
