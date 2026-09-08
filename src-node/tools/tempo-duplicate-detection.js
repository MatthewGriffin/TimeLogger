/** Conservative matching for reconciling local entries with Tempo worklogs. */

const DUPLICATE_START_TOLERANCE_MINS = 1;

const normaliseDescription = (text) => String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
const normaliseTicket = (ticket) => String(ticket || '').trim().toUpperCase();

const startSlotMinutes = (value) => {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ''));
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
};

/**
 * Consume and return a matching Tempo worklog so one remote row cannot absorb
 * two local entries during a bulk submission.
 */
export function takeDuplicateWorklog(entry, pool, issueId = null) {
  const ticket = normaliseTicket(entry.ticket_id);
  const numericIssueId = Number.isSafeInteger(Number(issueId)) ? Number(issueId) : null;
  if (!ticket && numericIssueId === null) return null;

  const entryStart = startSlotMinutes(entry.start_time);
  const entryMins = Number(entry.duration_mins) || 0;
  const entryDesc = normaliseDescription(entry.name);

  const isSameIssue = (log) => (
    numericIssueId !== null && Number(log.issueId) === numericIssueId
  ) || (
    (numericIssueId === null || log.issueId == null) &&
    ticket !== '' && normaliseTicket(log.ticketId) === ticket
  );

  let index = pool.findIndex(log => {
    if (!isSameIssue(log)) return false;
    const logStart = startSlotMinutes(log.startTime);
    return entryStart !== null && logStart !== null &&
      Math.abs(logStart - entryStart) <= DUPLICATE_START_TOLERANCE_MINS;
  });
  if (index !== -1) {
    const worklog = pool.splice(index, 1)[0];
    return {
      worklog,
      reason: worklog.durationMins === entryMins ? 'exact_match' : 'same_start_time',
      detail: worklog.durationMins === entryMins
        ? 'Already in Tempo'
        : `Already in Tempo at ${worklog.startTime} (${worklog.durationMins}m there vs ${entryMins}m here)`
    };
  }

  index = pool.findIndex(log => isSameIssue(log) &&
    log.durationMins === entryMins &&
    entryDesc !== '' &&
    normaliseDescription(log.description) === entryDesc);
  if (index !== -1) {
    const worklog = pool.splice(index, 1)[0];
    return { worklog, reason: 'same_duration_and_description', detail: 'Already in Tempo' };
  }

  return null;
}
