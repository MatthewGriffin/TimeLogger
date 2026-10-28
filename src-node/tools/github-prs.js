/**
 * Read-only GitHub pull-request integration.
 *
 * Every GitHub request in this module is GET-only. The token is stored locally
 * in the app database and is never returned to the frontend.
 */
import { db } from '../index.js';
import { makeHttpRequest } from '../api/http-client.js';

const API = 'https://api.github.com';
const PAGE_SIZE = 30;
const MAX_PRS = 60;
const EVENT_PR_LIMIT = 20;

export function extractTicketKeys(...values) {
  const keys = new Set();
  for (const value of values) {
    const text = String(value || '');
    for (const match of text.matchAll(/\b([A-Z][A-Z0-9]{1,15}-\d+)\b/gi)) keys.add(match[1].toUpperCase());
  }
  return [...keys];
}

export function classifyPullRequest(pr) {
  if (pr.merged || pr.merged_at) return 'merged';
  if (pr.state === 'closed') return 'closed';
  if (pr.draft) return 'draft';
  return 'open';
}

/**
 * Notifications are only relevant while a pull request is open and unmerged.
 * Draft PRs are still open on GitHub, so they remain eligible.
 */
export function isOpenUnmergedPullRequest(pr) {
  const state = String(pr?.state || '').toLowerCase();
  return (state === 'open' || state === 'draft')
    && !pr?.merged
    && !pr?.merged_at
    && !pr?.mergedAt;
}

function readConfig() {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'github_config'").get();
    return row?.value ? JSON.parse(row.value) : {};
  } catch {
    return {};
  }
}

async function githubGet(path, token) {
  if (!path.startsWith('/')) throw new Error('Invalid GitHub API path');
  try {
    const response = await makeHttpRequest(`${API}${path}`, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'TimeLogger-ReadOnly-GitHub-Integration'
      },
      timeoutMs: 12000
    });
    return response.data;
  } catch (error) {
    // Keep the failing endpoint and GitHub's status/message visible without
    // ever including request headers or the stored token.
    const message = error instanceof Error ? error.message : String(error);
    const status = message.match(/HTTP (\d{3})/i)?.[1];
    const detail = message.replace(/^HTTP \d{3}:\s*/i, '').slice(0, 500);
    throw new Error(`GitHub API request failed${status ? ` (HTTP ${status})` : ''} for ${path}: ${detail}`);
  }
}

function requireToken() {
  const token = String(readConfig().token || '');
  if (!token) throw new Error('GitHub is not connected. Add a read-only GitHub token in Settings → GitHub.');
  return token;
}

async function account(token) {
  const user = await githubGet('/user', token);
  if (!user?.login) throw new Error('GitHub did not return the linked account.');
  return user.login;
}

function safePr(pr, ticketKeys = []) {
  const keys = extractTicketKeys(pr.title, pr.body, pr.head?.ref);
  return {
    id: String(pr.id),
    number: pr.number,
    repository: pr.base?.repo?.full_name || pr.repository?.full_name || '',
    title: String(pr.title || ''),
    description: String(pr.body || ''),
    url: String(pr.html_url || ''),
    author: String(pr.user?.login || ''),
    branch: String(pr.head?.ref || ''),
    state: classifyPullRequest(pr),
    isDraft: Boolean(pr.draft),
    updatedAt: pr.updated_at || null,
    commentCount: Number(pr.comments || 0) + Number(pr.review_comments || 0),
    createdAt: pr.created_at || null,
    mergedAt: pr.merged_at || null,
    ticketKeys: keys,
    matchedTicketKeys: ticketKeys.length ? keys.filter(key => ticketKeys.includes(key)) : keys,
    requestedReviewer: (pr.requested_reviewers || []).some(r => String(r.login).toLowerCase() === String(pr.__linkedLogin || '').toLowerCase())
  };
}

async function searchPrs(token, login, query) {
  const all = [];
  for (let page = 1; page <= 3; page++) {
    const result = await githubGet(`/search/issues?q=${encodeURIComponent(query)}&per_page=${PAGE_SIZE}&page=${page}&sort=updated&order=desc`, token);
    const items = Array.isArray(result.items) ? result.items : [];
    all.push(...items);
    if (items.length < PAGE_SIZE || all.length >= MAX_PRS) break;
  }
  return all;
}

async function listRelevantPullRequests(token, ticketKeys = [], limit = MAX_PRS, diagnostics = null, openOnly = false) {
  const login = await account(token);
  const searchAndRecord = async (name, query) => {
    try {
      const results = await searchPrs(token, login, query);
      if (diagnostics) diagnostics.searches.push({ name, count: results.length });
      return results;
    } catch (error) {
      // A failure in one search should not discard valid results from the
      // other independent searches (for example, if GitHub rejects a query).
      if (diagnostics) {
        diagnostics.searches.push({ name, count: 0, error: error instanceof Error ? error.message : String(error) });
      }
      return [];
    }
  };
  const openQualifier = openOnly ? ' is:open' : '';
  const [authored, reviewRequested, reviewedByAccount] = await Promise.all([
    searchAndRecord('authored', `is:pr author:${login}${openQualifier}`),
    searchAndRecord('review-requested', `is:pr review-requested:${login} is:open`),
    searchAndRecord('reviewed-by-account', `is:pr reviewed-by:${login}${openQualifier}`)
  ]);
  const candidates = new Map();
  for (const item of [...authored, ...reviewRequested, ...reviewedByAccount]) {
    const repoUrl = String(item.repository_url || '');
    const match = repoUrl.match(/\/repos\/([^/]+\/[^/]+)$/);
    const number = Number(item.number);
    if (!match || !Number.isInteger(number)) continue;
    const repository = match[1];
    const key = `${repository}#${number}`;
    const prior = candidates.get(key) || { repository, number, fromReviewSearch: false, updatedAt: '' };
    if (reviewedByAccount.includes(item)) prior.fromReviewSearch = true;
    if (String(item.updated_at || '') > prior.updatedAt) prior.updatedAt = String(item.updated_at || '');
    candidates.set(key, prior);
  }

  if (diagnostics) diagnostics.candidateCount = candidates.size;
  const selected = [...candidates.values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
  const details = [];
  const fetchDetail = async (item) => {
    try {
      const pr = await githubGet(`/repos/${item.repository}/pulls/${item.number}`, token);
      const authoredByAccount = String(pr.user?.login || '').toLowerCase() === login.toLowerCase();
      const requested = (pr.requested_reviewers || []).some(r => String(r.login || '').toLowerCase() === login.toLowerCase());
      let reviewedByAccount = false;
      if (!authoredByAccount && !requested && item.fromReviewSearch) {
        const reviews = await githubGet(`/repos/${item.repository}/pulls/${item.number}/reviews?per_page=100`, token).catch(error => {
          if (diagnostics) diagnostics.detailFailures.push({
            repository: item.repository, number: item.number, endpoint: 'reviews',
            message: error instanceof Error ? error.message : String(error)
          });
          return [];
        });
        reviewedByAccount = Array.isArray(reviews) && reviews.some(review => String(review.user?.login || '').toLowerCase() === login.toLowerCase());
      }
      // Verify the account is the author, a current requested reviewer, or
      // actually reviewed the PR; search results alone are not trusted.
      if (!authoredByAccount && !requested && !reviewedByAccount) return null;
      const shaped = safePr({ ...pr, __linkedLogin: login }, ticketKeys);
      return { ...shaped, requestedReviewer: requested, isAuthoredByAccount: authoredByAccount, reviewedByAccount, pendingReview: requested }
    } catch (error) {
      if (diagnostics) diagnostics.detailFailures.push({
        repository: item.repository, number: item.number, endpoint: 'pull-request',
        message: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  };

  // Keep the number of in-flight detail/review requests bounded. Launching up
  // to 60 requests at once can trigger GitHub secondary rate limits, which
  // made otherwise valid pull requests disappear from the returned list.
  const DETAIL_CONCURRENCY = 6;
  for (let index = 0; index < selected.length; index += DETAIL_CONCURRENCY) {
    const batch = selected.slice(index, index + DETAIL_CONCURRENCY);
    details.push(...await Promise.all(batch.map(fetchDetail)));
  }

  return details.filter(Boolean).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function ensureEventTable() {
  db.exec(`CREATE TABLE IF NOT EXISTS github_pr_seen_events (
    event_id TEXT PRIMARY KEY,
    seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS github_pr_lifecycle (
    pr_key TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    requested_reviewer INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT
  )`);
}

async function pollReviewEvents(token, prs) {
  ensureEventTable();
  const known = new Set(db.prepare('SELECT event_id FROM github_pr_seen_events').all().map(row => row.event_id));
  const initialized = db.prepare("SELECT value FROM settings WHERE key = 'github_pr_poll_initialized'").get()?.value === 'true';
  const lifecycleHasBaseline = db.prepare("SELECT value FROM settings WHERE key = 'github_pr_lifecycle_initialized'").get()?.value === 'true';
  const linkedLogin = String(readConfig().login || await account(token)).toLowerCase();
  const lifecycleEvents = [];

  // Include previously tracked open review requests even if GitHub drops them
  // from the review-requested search after the PR is closed or merged.
  const currentKeys = new Set(prs.map(pr => `${pr.repository}#${pr.number}`));
  const previouslyRequested = db.prepare(
    "SELECT pr_key FROM github_pr_lifecycle WHERE state = 'open' AND requested_reviewer = 1"
  ).all().map(row => row.pr_key).filter(key => !currentKeys.has(key)).slice(0, EVENT_PR_LIMIT);
  const priorDetails = await Promise.all(previouslyRequested.map(async key => {
    const match = key.match(/^(.+)#(\\d+)$/);
    if (!match) return null;
    try {
      const raw = await githubGet(`/repos/${match[1]}/pulls/${match[2]}`, token);
      return safePr({ ...raw, __linkedLogin: linkedLogin });
    } catch {
      return null;
    }
  }));
  const lifecyclePrs = [...prs, ...priorDetails.filter(Boolean)];
  const upsertLifecycle = db.prepare(`INSERT INTO github_pr_lifecycle
    (pr_key, state, requested_reviewer, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(pr_key) DO UPDATE SET state = excluded.state,
      requested_reviewer = excluded.requested_reviewer, updated_at = excluded.updated_at`);
  db.transaction(() => {
    for (const pr of lifecyclePrs) {
      const key = `${pr.repository}#${pr.number}`;
      const prior = db.prepare('SELECT state, requested_reviewer FROM github_pr_lifecycle WHERE pr_key = ?').get(key);
      const state = pr.state === 'merged' ? 'merged' : pr.state === 'closed' ? 'closed' : 'open';
      const requestedReviewer = Boolean(pr.requestedReviewer);
      if (lifecycleHasBaseline && !prior && requestedReviewer && isOpenUnmergedPullRequest(pr)) {
        lifecycleEvents.push({
          id: `pr-added:${key}`, kind: 'added', reviewer: linkedLogin,
          title: pr.title, url: pr.url, repository: pr.repository, number: pr.number
        });
      } else if (lifecycleHasBaseline && prior?.state === 'open' && state === 'merged') {
        lifecycleEvents.push({
          id: `pr-merged:${key}`, kind: 'merged', reviewer: pr.author || 'A contributor',
          title: pr.title, url: pr.url, repository: pr.repository, number: pr.number
        });
      }
      upsertLifecycle.run(key, state, requestedReviewer ? 1 : 0, pr.updatedAt || null);
    }
  })();

  // Only open, unmerged PRs are eligible for comment/review alerts. Merged PRs
  // are still inspected above so the transition to merged can be announced.
  const activePrs = prs.filter(isOpenUnmergedPullRequest);
  const results = await Promise.all(activePrs.slice(0, EVENT_PR_LIMIT).map(async pr => {
    const base = `/repos/${pr.repository}/pulls/${pr.number}`;
    const [reviews, comments, discussionComments] = await Promise.all([
      githubGet(`${base}/reviews?per_page=100`, token).catch(() => []),
      githubGet(`${base}/comments?per_page=100`, token).catch(() => []),
      githubGet(`/repos/${pr.repository}/issues/${pr.number}/comments?per_page=100`, token).catch(() => [])
    ]);
    const discovered = [];
    const events = [];
    for (const review of Array.isArray(reviews) ? reviews : []) {
      const state = String(review.state || '').toUpperCase();
      if (!['APPROVED', 'COMMENTED', 'CHANGES_REQUESTED'].includes(state)) continue;
      const eventId = `review:${pr.repository}:${review.id}`;
      if (known.has(eventId)) continue;
      discovered.push(eventId);
      if (initialized && String(review.user?.login || '').toLowerCase() !== pr.author.toLowerCase() && String(review.user?.login || '').toLowerCase() !== linkedLogin) {
        events.push({
          id: eventId, kind: state === 'APPROVED' ? 'approval' : 'review',
          reviewer: review.user?.login || 'A reviewer', outcome: state,
          title: pr.title, url: pr.url, repository: pr.repository, number: pr.number,
          body: String(review.body || '').trim().slice(0, 240)
        });
      }
    }
    for (const comment of Array.isArray(comments) ? comments : []) {
      const eventId = `comment:${pr.repository}:${comment.id}`;
      if (known.has(eventId)) continue;
      discovered.push(eventId);
      if (initialized && String(comment.user?.login || '').toLowerCase() !== pr.author.toLowerCase() && String(comment.user?.login || '').toLowerCase() !== linkedLogin) {
        events.push({
          id: eventId, kind: 'inline-comment', reviewer: comment.user?.login || 'A reviewer',
          outcome: 'COMMENTED', title: pr.title, url: pr.url, repository: pr.repository,
          number: pr.number, body: String(comment.body || '').trim().slice(0, 240)
        });
      }
    }
    for (const comment of Array.isArray(discussionComments) ? discussionComments : []) {
      const eventId = `discussion-comment:${pr.repository}:${comment.id}`;
      if (known.has(eventId)) continue;
      discovered.push(eventId);
      if (initialized && String(comment.user?.login || '').toLowerCase() !== pr.author.toLowerCase() && String(comment.user?.login || '').toLowerCase() !== linkedLogin) {
        events.push({
          id: eventId, kind: 'discussion-comment', reviewer: comment.user?.login || 'A commenter',
          outcome: 'COMMENTED', title: pr.title, url: pr.url, repository: pr.repository,
          number: pr.number, body: String(comment.body || '').trim().slice(0, 240)
        });
      }
    }
    return { discovered, events };
  }));
  const discovered = results.flatMap(result => result.discovered);
  const events = [...lifecycleEvents, ...results.flatMap(result => result.events)];
  const insert = db.prepare('INSERT OR IGNORE INTO github_pr_seen_events (event_id) VALUES (?)');
  db.transaction(() => {
    discovered.forEach(id => insert.run(id));
    lifecycleEvents.forEach(event => insert.run(event.id));
    db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('github_pr_poll_initialized', 'true', CURRENT_TIMESTAMP)").run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('github_pr_lifecycle_initialized', 'true', CURRENT_TIMESTAMP)").run();
  })();
  return events;
}

/**
 * Return merged PRs that are relevant to the linked account's daily activity:
 * PRs authored by the account, plus PRs where the account submitted an APPROVED
 * review. A generic reviewed-by search is not enough; the review state is
 * verified against the pull-request reviews endpoint.
 */
export async function getMergedPullRequestsByAccount() {
  const token = String(readConfig().token || '');
  if (!token) return [];
  const login = await account(token);
  const searches = await Promise.all([
    searchPrs(token, login, `is:pr is:merged author:${login}`),
    searchPrs(token, login, `is:pr is:merged reviewed-by:${login}`)
  ]);
  const candidates = new Map();
  for (const item of searches.flat()) {
    const repoUrl = String(item.repository_url || '');
    const match = repoUrl.match(/\\/repos\\/([^/]+\\/[^/]+)$/);
    if (!match || !Number.isInteger(Number(item.number))) continue;
    candidates.set(`${match[1]}#${item.number}`, { repository: match[1], number: Number(item.number) });
  }

  const selected = [...candidates.values()].sort((a, b) => 0).slice(0, MAX_PRS);
  const merged = [];
  const concurrency = 5;
  for (let i = 0; i < selected.length; i += concurrency) {
    const batch = await Promise.all(selected.slice(i, i + concurrency).map(async item => {
      try {
        const pr = await githubGet(`/repos/${item.repository}/pulls/${item.number}`, token);
        if (!pr.merged_at) return null;
        const authored = String(pr.user?.login || '').toLowerCase() === login.toLowerCase();
        if (!authored) {
          const reviews = await githubGet(`/repos/${item.repository}/pulls/${item.number}/reviews?per_page=100`, token).catch(() => []);
          const approved = Array.isArray(reviews) && reviews.some(review =>
            String(review.user?.login || '').toLowerCase() === login.toLowerCase() &&
            String(review.state || '').toUpperCase() === 'APPROVED');
          if (!approved) return null;
        }
        return {
          ...safePr({ ...pr, __linkedLogin: login }),
          isAuthoredByAccount: authored,
          reviewedByAccount: !authored,
          requestedReviewer: false,
          pendingReview: false
        };
      } catch (error) {
        console.warn(`Could not load merged PR ${item.repository}#${item.number} for scrum:`, error.message);
        return null;
      }
    }));
    merged.push(...batch.filter(Boolean));
  }
  return merged;
}

export async function getPullRequestsForTickets(ticketValues = []) {
  const token = String(readConfig().token || '');
  if (!token) return [];
  const keys = extractTicketKeys(...ticketValues);
  if (!keys.length) return [];
  const prs = await listRelevantPullRequests(token, keys);
  return prs.filter(pr => pr.matchedTicketKeys.length > 0);
}

export const tools = [
  {
    name: 'github_pr_connection_status',
    description: 'Get GitHub read-only integration connection status without returning the stored token',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: async () => {
      try {
        const config = readConfig();
        if (!config.token) return { connected: false, login: '', message: 'No GitHub token configured.' };
        const login = await account(config.token);
        return { connected: true, login, message: `Connected to GitHub as @${login} (read-only)` };
      } catch (error) {
        return { connected: false, login: '', message: error.message };
      }
    }
  },
  {
    name: 'github_pr_save_token',
    description: 'Store or clear the local GitHub read-only token. This integration uses only GitHub GET endpoints.',
    parameters: {
      type: 'object',
      properties: { token: { type: 'string', description: 'GitHub token with read-only metadata/pull-request access; empty clears it' } },
      required: ['token']
    },
    handler: async ({ token }) => {
      const value = String(token || '').trim();
      if (value) {
        const login = await account(value);
        db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('github_config', ?, CURRENT_TIMESTAMP)")
          .run(JSON.stringify({ token: value, login }));
        return { success: true, connected: true, login, message: `Connected as @${login}. Only read-only GET requests are used.` };
      }
      db.prepare("DELETE FROM settings WHERE key = 'github_config'").run();
      try { db.prepare('DELETE FROM github_pr_seen_events').run(); } catch { /* table is created on first poll */ }
      db.prepare("DELETE FROM settings WHERE key = 'github_pr_poll_initialized'").run();
      db.prepare("DELETE FROM settings WHERE key = 'github_pr_lifecycle_initialized'").run();
      try { db.prepare('DELETE FROM github_pr_lifecycle').run(); } catch { /* table is created on first poll */ }
      return { success: true, connected: false, login: '', message: 'GitHub disconnected.' };
    }
  },
  {
    name: 'github_pr_list',
    description: 'List pull requests authored by the linked GitHub account or where it is currently requested as reviewer; includes state and ticket-key matches.',
    parameters: {
      type: 'object',
      properties: { ticketKeys: { type: 'array', items: { type: 'string' } } },
      required: []
    },
    handler: async ({ ticketKeys = [] }) => {
      try {
        const diagnostics = { searches: [], candidateCount: 0, detailFailures: [] };
        const prs = await listRelevantPullRequests(requireToken(), extractTicketKeys(...ticketKeys), MAX_PRS, diagnostics);
        return { success: true, prs, diagnostics };
      } catch (error) {
        return { success: false, message: error.message };
      }
    }
  },
  {
    name: 'github_pr_poll_activity',
    description: 'Poll review submissions and inline review comments for relevant pull requests, returning only newly discovered events after the initial baseline.',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: async () => {
      try {
        const token = requireToken();
        const prs = await listRelevantPullRequests(token, [], MAX_PRS, null, false);
        const events = await pollReviewEvents(token, prs);
        return { success: true, events };
      } catch (error) {
        return { success: false, message: error.message };
      }
    }
  }
];
