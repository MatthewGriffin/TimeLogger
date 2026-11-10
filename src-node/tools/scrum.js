/**
 * Daily scrum summary.
 *
 * Builds the "yesterday / today / blockers" report read out at stand-up from
 * time entries and notes that are already in the database, so nothing has to
 * be written twice.
 */

import { db } from '../index.js';
import { localDateKey } from '../utils/dates.js';
import { previousWorkingDay } from '../utils/working-days.js';
import { plannedWorkFor } from './scrum-plan.js';
import { readSprintConfig, matchMeetingTicket } from './sprint.js';
import {
  connectedGitHubAccount,
  extractTicketKeys,
  getPullRequestsForTickets,
  getPullRequestsWithMajorUpdatesOnDate,
  onPullRequestsPolled
} from './github-prs.js';

// Fetching these uses many requests against GitHub's rate limit, so they're kept
// until the app's GitHub poll finds a change that affects them.
let cachedPullRequests = null;
let pullRequestFetch = null;

/** Read the configured lunch name so it can be filtered out by whatever it is called. */
function lunchName() {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'app_config'").get();
    const parsed = row?.value ? JSON.parse(row.value) : {};
    return String(parsed?.lunch?.name || 'Lunch').toLowerCase();
  } catch {
    return 'lunch';
  }
}

/**
 * Whether an entry is the stand-up itself.
 *
 * Only an explicit alias match counts: `matchMeetingTicket` falls back to a
 * default meeting ticket, and treating that as a ceremony would silently drop
 * ordinary meetings from the report.
 */
function isDailyScrum(entry, sprintConfig) {
  const match = matchMeetingTicket(entry.name, sprintConfig);
  return match?.source === 'alias' && match.typeId === 'dailyScrum';
}

/**
 * Entries worth reporting for a date.
 *
 * Lunch, leave and the stand-up itself are dropped: none of them is work you
 * would report, and the stand-up in particular would have you announcing that
 * you attended the meeting you are currently in.
 */
function reportableEntries(date, sprintConfig, lunch) {
  const rows = db.prepare(`
    SELECT id, ticket_id, name, start_time, end_time, duration_mins, is_holiday, from_calendar
    FROM daily_summary
    WHERE date = ?
    ORDER BY start_time ASC
  `).all(date);

  return rows.filter(row => {
    if (row.is_holiday) return false;
    if (String(row.name || '').toLowerCase() === lunch) return false;
    if (isDailyScrum(row, sprintConfig)) return false;
    return true;
  });
}

/**
 * Notes that give context to a day's work.
 *
 * Covers both notes written on the day and notes filed against a ticket worked
 * that day, since a note recorded on Monday about TIME-101 is still the best
 * description of Tuesday's work on TIME-101. Open blockers are excluded because
 * they are reported in their own section.
 */
function notesForDay(date, ticketIds) {
  const open = 'AND NOT (is_blocker = 1 AND blocker_resolved_at IS NULL)';
  const byDate = db.prepare(
    `SELECT id, date, note, title, topic, ticket_id FROM notes WHERE date = ? ${open}`
  ).all(date);

  let byTicket = [];
  if (ticketIds.length > 0) {
    const placeholders = ticketIds.map(() => '?').join(',');
    byTicket = db.prepare(
      `SELECT id, date, note, title, topic, ticket_id
       FROM notes
       WHERE ticket_id IN (${placeholders}) AND date != ? ${open}
       ORDER BY date DESC
       LIMIT 20`
    ).all(...ticketIds, date);
  }

  const seen = new Set();
  return [...byDate, ...byTicket].filter(note => {
    if (seen.has(note.id)) return false;
    seen.add(note.id);
    return true;
  });
}

/** Blockers still open, oldest first, regardless of when they were raised. */
function openBlockers() {
  return db.prepare(`
    SELECT id, date, note, title, ticket_id
    FROM notes
    WHERE is_blocker = 1 AND blocker_resolved_at IS NULL
    ORDER BY date ASC
  `).all();
}

function formatDuration(mins) {
  const total = Number(mins) || 0;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}

/** Collapse a day's entries to one line per ticket, longest first. */
function groupByTicket(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const key = entry.ticket_id || 'No ticket';
    const existing = groups.get(key) || { ticket: key, minutes: 0, tasks: [] };
    existing.minutes += entry.duration_mins || 0;
    const name = String(entry.name || '').trim();
    if (name && !existing.tasks.includes(name)) existing.tasks.push(name);
    groups.set(key, existing);
  }
  return [...groups.values()].sort((a, b) => b.minutes - a.minutes);
}

/**
 * Compose the report without the LLM.
 *
 * This is a first-class path, not an error case: Ollama is optional throughout
 * the app, so the tab has to be useful with it switched off.
 */
function fallbackSummary(yesterday, today, blockers) {
  const descriptions = (day, meetings) => {
    const entries = day.entries.filter(entry => Boolean(entry.from_calendar) === meetings);
    return groupByTicket(entries).map(group => {
      const tasks = group.tasks.slice(0, 2).join(', ');
      const ticket = group.ticket === 'No ticket' ? '' : `${group.ticket}: `;
      return `${ticket}${tasks} · ${formatDuration(group.minutes)}`;
    });
  };
  const sentenceList = (items, emptyText) => items.length ? items.join('; ') : emptyText;
  const yesterdayWork = descriptions(yesterday, false);
  const yesterdayMeetings = descriptions(yesterday, true);
  const todayWork = descriptions(today, false);
  const todayMeetings = descriptions(today, true);
  const loggedTodayTickets = new Set(
    today.entries.filter(entry => !entry.from_calendar && entry.ticket_id).map(entry => entry.ticket_id)
  );
  const planned = today.planned
    .filter(item => !loggedTodayTickets.has(item.ticket_id))
    .map(item => {
      const summary = String(item.summary || '').trim();
      return summary ? `${item.ticket_id}: ${summary}` : item.ticket_id;
    });

  const todayIntent = todayWork.length
    ? `I am working on ${sentenceList(todayWork, 'no development work logged yet')}`
    : planned.length
      ? `I plan to work on ${sentenceList(planned, 'the planned work')}`
      : 'I have no development work logged yet';
  const plannedFollowUp = todayWork.length && planned.length
    ? ` I plan to pick up ${sentenceList(planned, 'the remaining planned work')} next.`
    : '';
  const blockerText = blockers.length
    ? blockers.map(b => `${b.ticket_id ? `${b.ticket_id}: ` : ''}${String(b.title || b.note).trim()}`).join('; ')
    : 'No blockers';

  return [
    `Yesterday I worked on: ${sentenceList(yesterdayWork, 'no development tasks logged')}.`,
    `I also had meetings / training: ${sentenceList(yesterdayMeetings, 'none logged')}.`,
    `Today I'll be working on: ${todayIntent}.${plannedFollowUp}`,
    `Meetings / training today: ${sentenceList(todayMeetings, 'none scheduled or logged')}.`,
    `Blockers: ${blockerText}.`
  ].join(' ');
}

/**
 * Daily Scrum PRs must name a ticket worked on yesterday in their title,
 * description or branch. Of those, it lists PRs the account authored or reviews,
 * plus any with a major lifecycle change or a mention of the account yesterday.
 * Page visits can overlap, so requests for the same PRs share one fetch.
 */
function fetchPullRequests(scope) {
  if (pullRequestFetch?.key === scope.key) return pullRequestFetch.promise;
  const promise = (async () => {
    const [ticketPullRequests, majorUpdatePullRequests, blockerPullRequests] = await Promise.all([
      getPullRequestsForTickets(scope.tickets),
      getPullRequestsWithMajorUpdatesOnDate(scope.yesterday, scope.tickets),
      getPullRequestsForTickets(scope.blockerTickets)
    ]);
    const byId = new Map();
    // The same PR can come from both searches. Keep every field either one set,
    // so the card shows what the Pull Requests page would.
    for (const pr of [...ticketPullRequests, ...majorUpdatePullRequests, ...blockerPullRequests]) {
      const prior = byId.get(pr.id);
      byId.set(pr.id, prior ? mergePullRequest(prior, pr) : pr);
    }
    const pullRequests = [...byId.values()].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    cachedPullRequests = { ...scope, pullRequests, outdated: false };
    return cachedPullRequests;
  })().finally(() => {
    if (pullRequestFetch?.promise === promise) pullRequestFetch = null;
  });
  pullRequestFetch = { key: scope.key, promise };
  return promise;
}

/** Combine two copies of a PR: flags are kept if either has them, and the newer update wins. */
function mergePullRequest(a, b) {
  const merged = { ...a, ...b };
  for (const flag of ['requestedReviewer', 'isAuthoredByAccount', 'reviewedByAccount', 'mentionsAccount', 'pendingReview']) {
    merged[flag] = Boolean(a[flag] || b[flag]);
  }
  merged.commentCount = Math.max(Number(a.commentCount) || 0, Number(b.commentCount) || 0);
  return merged;
}

/** Ticket keys an open blocker is about: its ticket field, plus any named in its title or note. */
function blockerTicketKeys(blocker) {
  return extractTicketKeys(blocker.ticket_id, blocker.title, blocker.note);
}

/**
 * Mark the PRs linked to an open blocker's ticket with those tickets, and list
 * them first. The rest keep their order, which is most recently updated first.
 */
function markBlockerPullRequests(pullRequests, blockers) {
  const blocked = new Set(blockers.flatMap(blockerTicketKeys));
  const marked = pullRequests.map(pr => ({ ...pr, blockedTicketKeys: pr.ticketKeys.filter(key => blocked.has(key)) }));
  return [...marked.filter(pr => pr.blockedTicketKeys.length), ...marked.filter(pr => !pr.blockedTicketKeys.length)];
}

/**
 * The report's pull requests and each open blocker's, from GitHub only when the
 * cached ones don't apply. Blocker PRs are the ones linked to the blocker's
 * ticket that the account authored or reviews.
 */
async function pullRequestsForReport(yesterday, tickets, blockers) {
  const uniqueTickets = [...new Set(tickets)].sort();
  const blockerTickets = [...new Set(blockers.flatMap(blockerTicketKeys))].sort();
  const account = connectedGitHubAccount();
  const scope = {
    key: JSON.stringify([yesterday, uniqueTickets, blockerTickets, account]),
    yesterday, tickets: uniqueTickets, blockerTickets, account
  };
  const cached = cachedPullRequests?.key === scope.key ? cachedPullRequests : null;
  if (cached && !cached.outdated) return cached;
  try {
    return await fetchPullRequests(scope);
  } catch (error) {
    // GitHub is optional; a network or authentication issue must not make the
    // core stand-up summary unavailable. Outdated results stay marked as such,
    // so the next poll or page visit tries again.
    console.warn('Could not load GitHub pull requests for scrum:', error.message);
    return cached ?? { pullRequests: [] };
  }
}

/**
 * Whether a poll found a change to the report's pull requests.
 *
 * The poll's own searches don't use the report's rules, so a PR outside the
 * report only counts if it changed since the last poll and names a ticket worked
 * yesterday.
 */
function pollAffectsReport(cached, { prs, changed, removed }) {
  const inReport = new Map(cached.pullRequests.map(pr => [pr.id, pr]));
  if (prs.some(pr => inReport.has(pr.id) && inReport.get(pr.id).updatedAt !== pr.updatedAt)) return true;

  const reportKeys = new Set(cached.pullRequests.map(pr => `${pr.repository}#${pr.number}`));
  if (removed.some(key => reportKeys.has(key))) return true;

  const workedTickets = new Set(extractTicketKeys(...cached.tickets, ...cached.blockerTickets));
  return changed.some(pr => !inReport.has(pr.id) && pr.ticketKeys.some(key => workedTickets.has(key)));
}

onPullRequestsPolled(async poll => {
  const cached = cachedPullRequests;
  // A result for another day or account is replaced on the next page visit.
  if (!cached || cached.yesterday !== previousWorkingDay(localDateKey()) || cached.account !== connectedGitHubAccount()) {
    return false;
  }
  if (!cached.outdated && !pollAffectsReport(cached, poll)) return false;
  cached.outdated = true;
  try {
    await fetchPullRequests(cached);
    return true;
  } catch (error) {
    console.warn('Could not refresh GitHub pull requests for scrum:', error.message);
    return false;
  }
});

export const tools = [
  {
    name: 'generate_scrum_summary',
    description: 'Build the daily stand-up report: the previous working day, today, open blockers, and a paragraph to read out',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'The "today" date; defaults to the current local date' }
      },
      required: []
    },
    handler: async (args) => {
      try {
        const today = args.date || localDateKey();
        const yesterday = previousWorkingDay(today);
        if (!yesterday) {
          return { success: false, message: `Could not resolve a working day before ${today}` };
        }

        const sprintConfig = readSprintConfig();
        const lunch = lunchName();

        const build = (date) => {
          const entries = reportableEntries(date, sprintConfig, lunch);
          const ticketIds = [...new Set(entries.map(e => e.ticket_id).filter(Boolean))];
          return {
            date,
            entries,
            notes: notesForDay(date, ticketIds),
            planned: [],
            totalMinutes: entries.reduce((sum, e) => sum + (e.duration_mins || 0), 0)
          };
        };

        const previous = build(yesterday);
        const current = build(today);
        // Only the reported day carries a plan. Yesterday's intent is not
        // worth reporting: what matters about yesterday is what was done.
        current.planned = plannedWorkFor(today);
        const blockers = openBlockers();

        const summary = fallbackSummary(previous, current, blockers);
        const workedTicketValues = previous.entries.map(entry => entry.ticket_id).filter(Boolean);
        const { pullRequests } = await pullRequestsForReport(yesterday, workedTicketValues, blockers);

        return {
          success: true,
          yesterday: previous,
          today: current,
          blockers,
          summary,
          pullRequests: markBlockerPullRequests(pullRequests, blockers)
        };
      } catch (error) {
        return { success: false, message: `Failed to build scrum summary: ${error.message}` };
      }
    }
  }
];
