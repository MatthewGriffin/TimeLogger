/**
 * Sprint planning.
 *
 * Two phases share one page. While planning, tickets are added to and removed
 * from a list for the next sprint and their story points are totalled against
 * the points available. Once the user confirms, the same list becomes a
 * progress view of those tickets as Jira currently reports them.
 *
 * The list is local and nothing is written back to Jira. Notes against a ticket
 * are ordinary notes (`create_note` with a ticket id), so they appear on the
 * Notes page with every other note for that ticket.
 */
import { db } from '../index.js';
import { localDateKey } from '../utils/dates.js';
import { sprintTimeline, workdayHours, supportSpent, clearSupportCache, expectedPoints } from './sprint-progress.js';
import { makeHttpRequest } from '../api/http-client.js';
import { getPullRequestsForTickets } from './github-prs.js';
import {
  resolveJiraCredentials,
  jiraHeaders,
  searchIssues,
  getCurrentAccount,
  myTicketsClause,
  escapeJql,
  toSearchTerms,
  scoreIssue,
  ISSUE_KEY_PATTERN
} from './jira-tempo-auth.js';

const STATE_KEY = 'sprint_plan_state';
const KEY_ONLY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

function readState() {
  let stored = {};
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(STATE_KEY);
    stored = row?.value ? JSON.parse(row.value) : {};
  } catch { /* fall back to a fresh plan */ }
  return {
    phase: stored.phase === 'active' ? 'active' : 'planning',
    capacity: Number.isFinite(stored.capacity) && stored.capacity >= 0 ? stored.capacity : null,
    boardId: /^\d+$/.test(String(stored.boardId || '')) ? String(stored.boardId) : '',
    // A board link pasted by the user, opened exactly as given.
    boardUrl: typeof stored.boardUrl === 'string' ? stored.boardUrl : '',
    startedAt: stored.startedAt || null,
    // Story points for the whole sprint to keep for support, where one point is a day's work.
    supportPoints: Number.isFinite(stored.supportPoints) && stored.supportPoints >= 0 ? stored.supportPoints : null,
    // Last day of the sprint; empty means two weeks from the start.
    endsOn: /^\d{4}-\d{2}-\d{2}$/.test(String(stored.endsOn || '')) ? stored.endsOn : ''
  };
}

function writeState(state) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
    .run(STATE_KEY, JSON.stringify(state));
}

/** A board id, or the id inside a pasted board link such as .../boards/166. */
export function parseBoardId(input) {
  const text = String(input || '').trim();
  if (!text) return '';
  if (/^\d+$/.test(text)) return text;
  return text.match(/\/boards\/(\d+)/)?.[1] || null;
}

/**
 * A pasted board link, kept only if it is an https link with /boards/<number>.
 * It is opened as the user gave it, since that is the link known to work for
 * them. Its host is checked against the Jira site when it is opened.
 */
export function parseBoardUrl(input) {
  try {
    const url = new URL(String(input || '').trim());
    if (url.protocol !== 'https:' || !/\/boards\/\d+/.test(url.pathname)) return '';
    return url.toString();
  } catch { return ''; }
}

// Board columns change rarely and the page asks every time it opens.
const COLUMN_CACHE_MS = 5 * 60 * 1000;
const QUIET_REFRESH_MS = 2 * 60 * 1000;
let lastQuietRefresh = 0;
const columnCache = new Map();

/**
 * The board's columns in order, cached for a few minutes. Throws when Jira
 * can't be read, so each caller decides whether that matters.
 */
async function readBoardColumns() {
  const { boardId } = readState();
  if (!boardId) return [];
  const credentials = resolveJiraCredentials({});
  const cacheKey = `${credentials.baseUrl}|${boardId}`;
  const cached = columnCache.get(cacheKey);
  if (cached && Date.now() - cached.at < COLUMN_CACHE_MS) return cached.columns;
  const response = await makeHttpRequest(`${credentials.baseUrl}/rest/agile/1.0/board/${boardId}/configuration`, {
    method: 'GET', headers: jiraHeaders(credentials)
  });
  const columns = (response.data?.columnConfig?.columns || []).map(column => ({
    name: String(column.name || ''),
    statusIds: (column.statuses || []).map(status => String(status.id))
  })).filter(column => column.name);
  columnCache.set(cacheKey, { at: Date.now(), columns });
  return columns;
}

let pointsFields = null;

/**
 * The custom fields that hold story points. Their ids differ between Jira
 * sites, and a site can have several ("Story point estimate" in team-managed
 * projects, "Story Points" in company-managed ones), so every field named like
 * story points is used and the first one a ticket has a value for wins. Only a
 * successful lookup is remembered, so a failed one is retried.
 */
async function findPointsFields(credentials) {
  if (pointsFields?.baseUrl === credentials.baseUrl) return pointsFields.ids;
  try {
    const response = await makeHttpRequest(`${credentials.baseUrl}/rest/api/3/field`, {
      method: 'GET', headers: jiraHeaders(credentials)
    });
    const fields = Array.isArray(response.data) ? response.data : [];
    const rank = name => (name === 'story point estimate' ? 0 : name === 'story points' ? 1 : 2);
    const ids = fields
      .map(field => ({ id: field.id, name: String(field.name || '').toLowerCase() }))
      .filter(field => field.id && /story\s*points?/.test(field.name))
      .sort((a, b) => rank(a.name) - rank(b.name))
      .map(field => field.id);
    pointsFields = { baseUrl: credentials.baseUrl, ids };
    return ids;
  } catch {
    return []; // points are then entered by hand
  }
}

function normalizeIssue(issue, fieldIds) {
  let points = null;
  for (const id of fieldIds) {
    const raw = issue.fields?.[id];
    if (raw == null || raw === '') continue;
    if (Number.isFinite(Number(raw))) { points = Number(raw); break; }
  }
  return {
    key: issue.key,
    summary: issue.fields?.summary || '',
    status: issue.fields?.status?.name || '',
    statusId: issue.fields?.status?.id ? String(issue.fields.status.id) : '',
    statusCategory: issue.fields?.status?.statusCategory?.key || '',
    points
  };
}

async function fetchIssues(credentials, jql, limit) {
  const fieldIds = await findPointsFields(credentials);
  const fields = ['key', 'summary', 'status', ...fieldIds].join(',');
  const issues = await searchIssues(credentials, jql, { limit, fields });
  return issues.map(issue => normalizeIssue(issue, fieldIds));
}

function planned() {
  return db.prepare(`
    SELECT t.ticket_id AS key, t.summary, t.status, t.status_id AS statusId, t.status_category AS statusCategory,
      t.points, t.points_manual AS pointsManual,
      (SELECT COUNT(*) FROM notes n WHERE n.ticket_id = t.ticket_id COLLATE NOCASE) AS noteCount
    FROM sprint_plan_tickets t
    ORDER BY t.added_at ASC, t.ticket_id ASC
  `).all().map(row => ({ ...row, pointsManual: Boolean(row.pointsManual) }));
}

/** Story points planned against the points available. Unestimated tickets are counted, not guessed. */
// The board column where a ticket's development is finished and it waits for review.
const PULL_REQUEST_COLUMN = /\bPR\b|pull request|code review|in review/i;

export function summarisePlan(tickets, capacity, boardColumns = []) {
  const sum = list => list.reduce((total, ticket) => total + (ticket.points || 0), 0);
  const total = sum(tickets);
  // With the board's columns, a ticket is to do in the first column, done in the
  // last and in progress in any between, so the counters agree with the columns
  // on the page. Without them, or for a status on no column, Jira's status
  // category decides.
  const stageOf = ticket => {
    const index = boardColumns.findIndex(column => ticket.statusId && column.statusIds.includes(ticket.statusId));
    if (index >= 0 && boardColumns.length > 1) return index === 0 ? 'todo' : index === boardColumns.length - 1 ? 'done' : 'inProgress';
    return ticket.statusCategory === 'done' ? 'done' : ticket.statusCategory === 'indeterminate' ? 'inProgress' : 'todo';
  };
  const inStage = stage => tickets.filter(ticket => stageOf(ticket) === stage);
  // Development is finished once a ticket reaches the pull request column, or any
  // after it, so those count as completed. It only goes back if QA bounces it.
  // With no such column, or no columns, only done tickets are completed.
  const prColumn = boardColumns.findIndex(column => PULL_REQUEST_COLUMN.test(column.name));
  const isCompleted = ticket => {
    const index = boardColumns.findIndex(column => ticket.statusId && column.statusIds.includes(ticket.statusId));
    if (prColumn >= 0 && index >= 0) return index >= prColumn;
    return stageOf(ticket) === 'done';
  };
  const completedTickets = tickets.filter(isCompleted);
  const done = sum(inStage('done'));
  const inProgress = sum(inStage('inProgress'));
  return {
    tickets: tickets.length,
    planned: total,
    done,
    inProgress,
    todo: total - done - inProgress,
    // Tickets as well as points: a ticket with no estimate adds no points, so points alone read as zero.
    completed: sum(completedTickets),
    completedCount: completedTickets.length,
    doneCount: inStage('done').length,
    inProgressCount: inStage('inProgress').length,
    todoCount: inStage('todo').length,
    unestimated: tickets.filter(ticket => ticket.points == null).length,
    capacity,
    remaining: capacity == null ? null : capacity - total,
    overCapacity: capacity != null && total > capacity
  };
}

async function view() {
  const state = readState();
  const tickets = planned();
  let columns = [];
  // Only a running sprint is counted by column; a board that can't be read falls back to status categories.
  if (state.phase === 'active') { try { columns = await readBoardColumns(); } catch { columns = []; } }
  return { state, tickets, summary: summarisePlan(tickets, state.capacity, columns) };
}

/**
 * Refresh stored tickets from Jira in one query. Points estimated in Jira win,
 * since they change during planning; hand-entered points stay only while Jira
 * has no estimate.
 */
async function refreshFromJira() {
  const keys = db.prepare('SELECT ticket_id FROM sprint_plan_tickets').all().map(row => row.ticket_id);
  if (keys.length === 0) return;
  const credentials = resolveJiraCredentials({});
  const found = await fetchIssues(credentials, `key in (${keys.map(key => `"${escapeJql(key)}"`).join(',')})`, keys.length);
  const update = db.prepare(`
    UPDATE sprint_plan_tickets
    SET summary = ?, status = ?, status_category = ?, status_id = ?,
        points = CASE WHEN ? IS NOT NULL THEN ? WHEN points_manual = 1 THEN points ELSE NULL END,
        points_manual = CASE WHEN ? IS NOT NULL THEN 0 ELSE points_manual END
    WHERE ticket_id = ?
  `);
  db.transaction(() => {
    for (const issue of found) update.run(issue.summary, issue.status, issue.statusCategory, issue.statusId, issue.points, issue.points, issue.points, issue.key);
  })();
}

const fail = (action, error) => ({ success: false, message: `Could not ${action}: ${error.message}` });

export const tools = [
  {
    name: 'sprint_plan_get',
    description: 'Get the sprint plan: its phase, the planned tickets and the story point totals against capacity',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: async () => {
      try { return { success: true, ...(await view()) }; } catch (error) { return fail('read the sprint plan', error); }
    }
  },
  {
    name: 'sprint_plan_search',
    description: 'Search Jira for tickets to add to the sprint plan. With no text, lists the user\'s open tickets',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: [] },
    handler: async (args) => {
      try {
        const credentials = resolveJiraCredentials({});
        const text = String(args.query || '').trim();
        const open = 'statusCategory != Done';
        let found = [];
        const explicitKey = text.toUpperCase().match(ISSUE_KEY_PATTERN);
        if (!text) {
          found = await fetchIssues(credentials, `${open} AND ${await myTicketsClause(credentials)} ORDER BY updated DESC`, 20);
        } else if (explicitKey) {
          // Same as the other ticket lookups: a key is fetched directly, whatever its status.
          found = await fetchIssues(credentials, `key = "${escapeJql(explicitKey[1])}"`, 1);
        } else {
          // Same attempts as the other ticket lookups: the words in the summary,
          // then anywhere in the ticket, then any one of the words, so a
          // partly remembered name still finds it. Unlike them this is not
          // limited to the user's own tickets, because next sprint's work is
          // often not assigned to anyone yet.
          const terms = toSearchTerms(text);
          const joined = escapeJql(terms.length ? terms.join(' ') : text);
          const attempts = [`summary ~ "${joined}"`];
          if (terms.length) {
            attempts.push(`text ~ "${joined}"`);
            attempts.push(`(${terms.map(term => `summary ~ "${escapeJql(term)}"`).join(' OR ')})`);
          }
          for (const attempt of attempts) {
            found = await fetchIssues(credentials, `${open} AND ${attempt} ORDER BY updated DESC`, 20);
            if (found.length > 0) break;
          }
          found = found
            .map(issue => ({ issue, score: scoreIssue(issue.summary, text) }))
            .sort((a, b) => b.score - a.score)
            .map(entry => entry.issue);
        }
        const already = new Set(planned().map(ticket => ticket.key.toLowerCase()));
        return {
          success: true,
          issues: found.map(issue => ({ ...issue, planned: already.has(issue.key.toLowerCase()) })),
          count: found.length
        };
      } catch (error) { return fail('search Jira', error); }
    }
  },
  {
    name: 'sprint_plan_add',
    description: 'Add a ticket to the sprint plan (also once the sprint has started), reading its summary, status and story points from Jira',
    parameters: { type: 'object', properties: { ticket_id: { type: 'string' } }, required: ['ticket_id'] },
    handler: async (args) => {
      try {
        const key = String(args.ticket_id || '').trim().toUpperCase();
        if (!KEY_ONLY.test(key)) return { success: false, message: 'Enter a Jira ticket key such as ABC-123' };
        const [issue] = await fetchIssues(resolveJiraCredentials({}), `key = "${escapeJql(key)}"`, 1);
        if (!issue) return { success: false, message: `${key} was not found in Jira` };
        db.prepare(`
          INSERT INTO sprint_plan_tickets (ticket_id, summary, status, status_id, status_category, points)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(ticket_id) DO NOTHING
        `).run(issue.key, issue.summary, issue.status, issue.statusId, issue.statusCategory, issue.points);
        return { success: true, ...(await view()) };
      } catch (error) { return fail('add the ticket', error); }
    }
  },
  {
    name: 'sprint_plan_remove',
    description: 'Remove a ticket from the sprint plan, also once the sprint has started. Its notes are kept',
    parameters: { type: 'object', properties: { ticket_id: { type: 'string' } }, required: ['ticket_id'] },
    handler: async (args) => {
      try {
        db.prepare('DELETE FROM sprint_plan_tickets WHERE ticket_id = ?').run(String(args.ticket_id || '').trim());
        return { success: true, ...(await view()) };
      } catch (error) { return fail('remove the ticket', error); }
    }
  },
  {
    name: 'sprint_plan_set_points',
    description: 'Set story points by hand for a planned ticket Jira has no estimate for. Empty clears it back to Jira\'s value',
    parameters: {
      type: 'object',
      properties: { ticket_id: { type: 'string' }, points: { type: ['number', 'null'] } },
      required: ['ticket_id']
    },
    handler: async (args) => {
      try {
        const key = String(args.ticket_id || '').trim();
        if (args.points == null || args.points === '') {
          db.prepare('UPDATE sprint_plan_tickets SET points = NULL, points_manual = 0 WHERE ticket_id = ?').run(key);
          try { await refreshFromJira(); } catch { /* the points simply stay empty offline */ }
        } else {
          const points = Number(args.points);
          if (!Number.isFinite(points) || points < 0 || points > 1000) return { success: false, message: 'Story points must be a number from 0 to 1000' };
          db.prepare('UPDATE sprint_plan_tickets SET points = ?, points_manual = 1 WHERE ticket_id = ?').run(points, key);
        }
        return { success: true, ...(await view()) };
      } catch (error) { return fail('set the points', error); }
    }
  },
  {
    name: 'sprint_plan_settings',
    description: 'Set the story points available for the sprint, the Jira board to link to (a board number or board link), the story points kept for support in the sprint, and the date the sprint ends',
    parameters: {
      type: 'object',
      properties: {
        capacity: { type: ['number', 'null'] },
        board: { type: 'string' },
        supportPoints: { type: ['number', 'null'] },
        endsOn: { type: ['string', 'null'] }
      },
      required: []
    },
    handler: async (args) => {
      try {
        const next = readState();
        if (args.capacity !== undefined) {
          if (args.capacity === null || args.capacity === '') next.capacity = null;
          else {
            const capacity = Number(args.capacity);
            if (!Number.isFinite(capacity) || capacity < 0 || capacity > 10000) return { success: false, message: 'Available story points must be a number from 0 to 10000' };
            next.capacity = capacity;
          }
        }
        if (args.board !== undefined) {
          const boardId = parseBoardId(args.board);
          if (boardId === null) return { success: false, message: 'Enter a board number or a Jira board link containing /boards/<number>' };
          next.boardId = boardId;
          next.boardUrl = parseBoardUrl(args.board);
        }
        if (args.supportPoints !== undefined) {
          if (args.supportPoints === null || args.supportPoints === '') next.supportPoints = null;
          else {
            const points = Number(args.supportPoints);
            if (!Number.isFinite(points) || points < 0 || points > 50) return { success: false, message: 'Support story points for the sprint must be from 0 to 50' };
            next.supportPoints = points;
          }
        }
        if (args.endsOn !== undefined) {
          if (args.endsOn === null || args.endsOn === '') next.endsOn = '';
          else if (!/^\d{4}-\d{2}-\d{2}$/.test(String(args.endsOn))) return { success: false, message: 'Enter the end date as a date' };
          else next.endsOn = String(args.endsOn);
        }
        writeState(next);
        clearSupportCache();
        return { success: true, ...(await view()) };
      } catch (error) { return fail('save the settings', error); }
    }
  },
  {
    name: 'sprint_plan_refresh',
    description: 'Refresh the planned tickets\' status and story points from Jira',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: async () => {
      try {
        await refreshFromJira();
        return { success: true, ...(await view()) };
      } catch (error) { return { ...fail('refresh from Jira', error), ...(await view()) }; }
    }
  },
  {
    name: 'sprint_plan_start',
    description: 'Confirm the plan and start the sprint, switching the page to the progress view',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: async () => {
      try {
        const current = await view();
        if (current.state.phase === 'active') return { success: true, ...current };
        if (current.tickets.length === 0) return { success: false, message: 'Add at least one ticket before starting the sprint' };
        writeState({ ...current.state, phase: 'active', startedAt: new Date().toISOString() });
        clearSupportCache();
        return { success: true, ...(await view()) };
      } catch (error) { return fail('start the sprint', error); }
    }
  },
  {
    name: 'sprint_plan_finish',
    description: 'Finish the sprint and go back to planning. Finished tickets leave the list and unfinished ones carry over',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: async () => {
      try {
        // Final statuses first, so a ticket finished since the last refresh is not carried over.
        try { await refreshFromJira(); } catch { /* the last known statuses are used */ }
        const current = readState();
        db.transaction(() => {
          db.prepare("DELETE FROM sprint_plan_tickets WHERE status_category = 'done'").run();
          writeState({ ...current, phase: 'planning', startedAt: null, endsOn: '' });
          clearSupportCache();
        })();
        return { success: true, ...(await view()) };
      } catch (error) { return fail('finish the sprint', error); }
    }
  },
  {
    name: 'sprint_plan_board_columns',
    description: 'The columns of the configured Jira board, in board order, with the status ids each holds',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: async () => {
      try {
        const columns = await readBoardColumns();
        return { success: true, columns };
      } catch (error) {
        // The page falls back to grouping by status, so this is not an error for the user.
        return { success: true, columns: [], message: `Could not read the board columns: ${error.message}` };
      }
    }
  },
  {
    name: 'sprint_plan_progress',
    description: 'How the running sprint is going: story points done against what is expected by now, and support time spent against the time kept for it',
    parameters: { type: 'object', properties: { refresh: { type: 'boolean' } }, required: [] },
    handler: async (args) => {
      try {
        const state = readState();
        if (state.phase !== 'active') return { success: true, active: false };
        // Keep the figures current without anyone pressing refresh, but not more than every couple of minutes.
        if (args.refresh !== false && Date.now() - lastQuietRefresh > QUIET_REFRESH_MS) {
          lastQuietRefresh = Date.now();
          try { await refreshFromJira(); } catch { /* the last known statuses are used */ }
        }
        const current = await view();
        const workday = workdayHours();
        const timeline = sprintTimeline(state.startedAt, state.endsOn, new Date(), workday);
        const summary = current.summary;
        let support = { points: state.supportPoints };
        if (state.supportPoints != null) {
          const today = localDateKey();
          const spent = await supportSpent(timeline.startDate, today < timeline.endDate ? today : timeline.endDate);
          // One story point is one day's work.
          const budgetMins = Math.round(state.supportPoints * workday.minutes);
          support = { points: state.supportPoints, ...spent, budgetMins, remainingMins: budgetMins - spent.spentMins };
        }
        // Expected by now: what was planned, less the time support has taken or still has to take.
        const expected = Math.round(expectedPoints({
          planned: summary.planned,
          timeline,
          supportPoints: state.supportPoints,
          supportSpentMins: support.spentMins || 0,
          workdayMinutes: workday.minutes
        }) * 10) / 10;
        return {
          success: true,
          active: true,
          timeline,
          hoursPerDay: Math.round((workday.minutes / 60) * 100) / 100,
          points: { completed: summary.completed, planned: summary.planned, expected, behind: Math.round((expected - summary.completed) * 10) / 10 },
          support
        };
      } catch (error) { return fail('work out the sprint progress', error); }
    }
  },
  {
    name: 'sprint_plan_pull_requests',
    description: 'The pull request behind each ticket in the sprint, where GitHub is connected and one names the ticket: an open one if there is one, otherwise the most recently updated',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: async () => {
      try {
        const keys = db.prepare('SELECT ticket_id FROM sprint_plan_tickets').all().map(row => row.ticket_id);
        if (!keys.length) return { success: true, pullRequests: {} };
        const found = await getPullRequestsForTickets(keys);
        const isOpen = pr => pr.state === 'open' || pr.state === 'draft';
        const pullRequests = {};
        for (const key of keys) {
          const matching = found.filter(pr => pr.ticketKeys.some(candidate => candidate.toUpperCase() === key.toUpperCase()) && pr.url);
          matching.sort((a, b) => (Number(isOpen(b)) - Number(isOpen(a))) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
          const best = matching[0];
          if (best) pullRequests[key] = { url: best.url, number: best.number, repository: best.repository, state: best.state, title: best.title };
        }
        return { success: true, pullRequests };
      } catch {
        // GitHub is optional: without it there is simply no link to offer.
        return { success: true, pullRequests: {} };
      }
    }
  },
  {
    name: 'sprint_plan_board_link',
    description: 'The link to the user\'s own view of the configured Jira sprint board',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: async () => {
      try {
        const { boardId, boardUrl } = readState();
        if (!boardId) return { success: false, message: 'Set the Jira board first' };
        const credentials = resolveJiraCredentials({});
        if (boardUrl && new URL(boardUrl).host === new URL(credentials.baseUrl).host) return { success: true, url: boardUrl };
        const account = await getCurrentAccount(credentials);
        return { success: true, url: `${credentials.baseUrl}/jira/people/${account.accountId}/boards/${boardId}` };
      } catch (error) { return fail('build the board link', error); }
    }
  }
];
