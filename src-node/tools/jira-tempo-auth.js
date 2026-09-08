import { makeHttpRequest } from '../api/http-client.js';
import { db } from '../index.js';

export function buildBasicAuth(email, apiToken) {
  return Buffer.from(`${email}:${apiToken}`).toString('base64');
}

/**
 * Read the Jira credentials saved in Settings.
 */
function readJiraConfig() {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('jira_config');
    if (!row?.value) return null;
    const config = JSON.parse(row.value);
    return {
      baseUrl: String(config.baseUrl || '').replace(/\/+$/, ''),
      email: config.email || null,
      apiToken: config.apiToken || null,
      tempoToken: config.tempoToken || null
    };
  } catch (error) {
    console.error('Failed to read Jira config:', error.message);
    return null;
  }
}

/**
 * Resolve the Tempo token from the call, falling back to Settings.
 */
export function resolveTempoToken(args = {}) {
  const token = args.tempoToken || readJiraConfig()?.tempoToken || null;
  if (!token) {
    throw new Error('Tempo is not configured. Add your Tempo API token in Settings.');
  }
  return token;
}

/**
 * Resolve credentials from the call, falling back to Settings so tools can be
 * invoked without the frontend having to pass secrets on every request.
 */
export function resolveJiraCredentials(args = {}) {
  const stored = readJiraConfig();
  const baseUrl = String(args.baseUrl || stored?.baseUrl || '').replace(/\/+$/, '');
  const email = args.email || stored?.email || null;
  const apiToken = args.apiToken || stored?.apiToken || null;

  if (!baseUrl || !email || !apiToken) {
    throw new Error('Jira is not configured. Add your Jira URL, email and API token in Settings.');
  }
  return { baseUrl, email, apiToken };
}

export function jiraHeaders({ email, apiToken }) {
  return {
    'Authorization': `Basic ${buildBasicAuth(email, apiToken)}`,
    'Content-Type': 'application/json'
  };
}

/**
 * Run a JQL search.
 *
 * Uses /rest/api/3/search/jql: the older /rest/api/3/search endpoint was
 * removed by Atlassian (CHANGE-2046) and now returns HTTP 410.
 */
export async function searchIssues(credentials, jql, { limit = 10, fields = 'key,summary,status' } = {}) {
  const url = `${credentials.baseUrl}/rest/api/3/search/jql` +
    `?jql=${encodeURIComponent(jql)}&maxResults=${limit}&fields=${encodeURIComponent(fields)}`;
  const response = await makeHttpRequest(url, { method: 'GET', headers: jiraHeaders(credentials) });
  return response.data?.issues || [];
}

let cachedAccount = null;

/**
 * Resolve the account the API token authenticates as. JQL functions such as
 * updatedBy() reject a nested currentUser(), so the literal id is required.
 */
export async function getCurrentAccount(credentials) {
  const cacheKey = `${credentials.baseUrl}|${credentials.email}`;
  if (cachedAccount?.key === cacheKey) return cachedAccount.value;

  const response = await makeHttpRequest(`${credentials.baseUrl}/rest/api/3/myself`, {
    method: 'GET',
    headers: jiraHeaders(credentials)
  });
  if (!response.data?.accountId) throw new Error('Jira did not return an account ID');

  const value = {
    accountId: response.data.accountId,
    displayName: response.data.displayName,
    email: response.data.emailAddress || credentials.email
  };
  cachedAccount = { key: cacheKey, value };
  return value;
}

/**
 * JQL escaping: quotes and backslashes must be escaped or the query is
 * rejected, and a stray quote in user input would otherwise break out of the
 * search term.
 */
export function escapeJql(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Jira issue keys look like ABC-123. */
export const ISSUE_KEY_PATTERN = /\b([A-Z][A-Z0-9_]+-\d+)\b/;

/**
 * Strip noise from a task name so it reads as search terms, e.g.
 * "PDONB-994 Api Side (WIP)" -> "Api Side".
 */
export function toSearchTerms(text) {
  return String(text || '')
    .replace(ISSUE_KEY_PATTERN, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2)
    .slice(0, 8);
}

/**
 * Score a candidate against the query so the best match can be auto-applied
 * without another round-trip to Jira.
 */
export function scoreIssue(summary, query) {
  const target = String(summary || '').toLowerCase();
  const source = String(query || '').toLowerCase().trim();
  if (!target || !source) return 0;
  if (target === source) return 1;
  if (target.includes(source)) return 0.9;

  const words = source.split(/\s+/).filter(w => w.length > 2);
  if (words.length === 0) return 0;
  const hits = words.filter(word => target.includes(word)).length;
  return (hits / words.length) * 0.8;
}
