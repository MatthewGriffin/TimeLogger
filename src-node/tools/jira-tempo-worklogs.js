import { makeHttpRequest } from '../api/http-client.js';
import { getActivityTypeValues } from './jira-tempo-activity.js';
import { jiraHeaders } from './jira-tempo-auth.js';

/**
 * Follow Tempo's `metadata.next` link until every page of a worklog listing
 * has been read. A day can span more results than the endpoint's max page
 * size, so stopping at the first page would silently under-report what is
 * already logged and risk a duplicate submission.
 */
export async function fetchAllTempoPages(url, tempoToken, request = makeHttpRequest) {
  const headers = {
    'Authorization': `Bearer ${tempoToken}`,
    'Content-Type': 'application/json'
  };

  const results = [];
  const visited = new Set();
  let nextUrl = url;
  let pages = 0;

  while (nextUrl) {
    if (++pages > 100) {
      throw new Error('Tempo returned too many pages for one request.');
    }

    // Tempo's metadata.next is an opaque absolute URL. Validate its destination
    // before attaching the bearer token, but pass the original string through
    // unchanged so pagination parameters are not rewritten.
    let parsed;
    try {
      parsed = new URL(nextUrl);
    } catch {
      throw new Error('Tempo returned an invalid pagination URL.');
    }
    if (parsed.origin !== 'https://api.tempo.io' || !parsed.pathname.startsWith('/4/')) {
      throw new Error('Tempo returned an unsafe pagination URL.');
    }
    if (visited.has(nextUrl)) {
      throw new Error('Tempo returned a pagination loop.');
    }
    visited.add(nextUrl);

    const response = await request(nextUrl, { method: 'GET', headers });
    if (Array.isArray(response.data?.results)) {
      results.push(...response.data.results);
    }
    nextUrl = response.data?.metadata?.next || null;
  }

  return results;
}

/**
 * Tempo worklogs only carry the numeric Jira issue id, not the human-readable
 * key or summary the rest of the app displays. Batched into one JQL lookup
 * rather than one request per worklog, since a reconcile can cover many days.
 */
async function resolveIssueKeys(credentials, issueIds) {
  const ids = [...new Set(issueIds.filter((id) => id !== null && id !== undefined && id !== ''))];
  const map = new Map();
  if (ids.length === 0) return map;

  const jql = `id in (${ids.join(',')})`;
  const url = `${credentials.baseUrl}/rest/api/3/search/jql` +
    `?jql=${encodeURIComponent(jql)}&maxResults=${ids.length}&fields=summary`;
  const response = await makeHttpRequest(url, { method: 'GET', headers: jiraHeaders(credentials) });

  for (const issue of response.data?.issues || []) {
    map.set(String(issue.id), { key: issue.key, summary: issue.fields?.summary || null });
  }
  return map;
}

/**
 * Update an existing Tempo worklog's date/time/duration so a resynced entry
 * (e.g. a meeting whose split-attendance times changed) stays in step with
 * what is already logged, instead of being left stale or double-booked.
 */
export async function updateTempoWorklogTimes(
  worklogId,
  tempoToken,
  { authorAccountId, startDate, startTime, timeSpentSeconds }
) {
  await makeHttpRequest(`https://api.tempo.io/4/worklogs/${worklogId}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${tempoToken}`,
      'Content-Type': 'application/json'
    },
    body: { authorAccountId, startDate, startTime, timeSpentSeconds }
  });
}

export async function deleteTempoWorklog(worklogId, tempoToken) {
  await makeHttpRequest(`https://api.tempo.io/4/worklogs/${worklogId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${tempoToken}`,
      'Content-Type': 'application/json'
    }
  });
}

/**
 * Fetch a user's Tempo worklogs for a range and shape them for the app.
 *
 * Shared by the reconcile view and the import path so both work from an
 * identical view of Tempo. Importing from client-supplied rows would let a
 * stale page write worklogs that no longer exist.
 */
export async function fetchTempoWorklogs(credentials, tempoToken, accountId, from, to) {
  const url = `https://api.tempo.io/4/worklogs/user/${encodeURIComponent(accountId)}` +
    `?from=${from}&to=${to}&limit=1000`;
  const raw = await fetchAllTempoPages(url, tempoToken);

  const issueKeys = await resolveIssueKeys(credentials, raw.map(w => w.issue?.id));

  let activityNames = {};
  try {
    const values = await getActivityTypeValues(tempoToken);
    activityNames = Object.fromEntries(values.map(v => [v.id, v.name]));
  } catch {
    activityNames = {};
  }

  return raw.map(entry => {
    const issue = issueKeys.get(String(entry.issue?.id));
    const activityId = entry.attributes?.values?.find(v => v.key === '_ActivityType_')?.value || null;
    return {
      worklogId: entry.tempoWorklogId,
      issueId: entry.issue?.id ?? null,
      ticketId: issue?.key || null,
      ticketSummary: issue?.summary || null,
      description: entry.description || '',
      date: entry.startDate,
      startTime: (entry.startTime || '').slice(0, 5),
      durationMins: Math.round((entry.timeSpentSeconds || 0) / 60),
      billableMins: Math.round((entry.billableSeconds || 0) / 60),
      activityTypeId: activityId,
      activityTypeName: activityId ? (activityNames[activityId] || null) : null,
      createdAt: entry.createdAt || null
    };
  }).sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
}

/**
 * Is this error a "the service is not answering" problem rather than a
 * rejected request?
 *
 * Used to decide whether the user should be told to check Tempo and retry, or
 * shown the raw fault. A DNS or socket error is never something they can fix
 * by changing their entries; a 5xx or a gateway timeout is equally transient.
 */
export function isConnectivityError(error) {
  const code = error?.code || error?.cause?.code || '';
  if (['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT',
       'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'ECONNABORTED'].includes(code)) {
    return true;
  }
  const status = error?.response?.status ?? error?.status;
  if (Number.isFinite(status) && (status >= 500 || status === 408 || status === 429)) return true;
  return /network error|socket hang up|timeout|getaddrinfo|ECONNREFUSED/i.test(String(error?.message || ''));
}
