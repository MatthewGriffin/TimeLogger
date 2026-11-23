/**
 * Support tickets.
 *
 * Lists the tickets of a saved Jira filter (by default the 4th line support
 * filter), so support work that gets passed between developers can be watched
 * in one place. Nothing is written back to Jira.
 */
import { db } from '../index.js';
import { makeHttpRequest } from '../api/http-client.js';
import { resolveJiraCredentials, jiraHeaders, getCurrentAccount } from './jira-tempo-auth.js';

const SETTINGS_KEY = 'support_tickets_settings';
const DEFAULT_FILTER_ID = '80556';
const MAX_TICKETS = 500;
const LIST_CACHE_MS = 60 * 1000;
const FIELD_CACHE_MS = 60 * 60 * 1000;

// Ids used when Jira can't be asked for the fields by name.
const FALLBACK_FIELDS = { supportRank: 'customfield_13287', productModule: 'customfield_10241' };

const fail = (action, error) => ({ success: false, message: `Could not ${action}: ${error.message}` });

/** A filter id, or the id inside a pasted link such as .../issues/?filter=80556. */
export function parseFilterId(input) {
  const text = String(input || '').trim();
  if (!text) return '';
  if (/^\d+$/.test(text)) return text;
  try {
    const url = new URL(text);
    const id = url.searchParams.get('filter') || url.pathname.match(/\/filter\/(\d+)/)?.[1] || '';
    return /^\d+$/.test(id) ? id : '';
  } catch {
    return '';
  }
}

function readSettings() {
  let stored = {};
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(SETTINGS_KEY);
    stored = row?.value ? JSON.parse(row.value) : {};
  } catch { /* fall back to the default filter */ }
  const filterId = /^\d+$/.test(String(stored.filterId || '')) ? String(stored.filterId) : DEFAULT_FILTER_ID;
  return { filterId, filterUrl: typeof stored.filterUrl === 'string' ? stored.filterUrl : '' };
}

function writeSettings(settings) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
    .run(SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * How a status reads at a glance, from its name: with the customer, with a
 * developer, stuck, being reviewed, or still being looked at. The status itself
 * is always shown as well, so a name that matches nothing here loses nothing.
 */
export function statusGroup(status) {
  const name = String(status || '').toLowerCase();
  if (/customer|reporter|3rd party|third party|provider|quote|client/.test(name)) return 'customer';
  if (/blocked|on hold|hold\b|suspended|abort|failed/.test(name)) return 'blocked';
  if (/code change|code problem|dev|build|release|integration|technical breakdown|estimation|implementation/.test(name)) return 'dev';
  if (/approval|review|sign-?off|cab\b|authoris|clinical|acceptance/.test(name)) return 'review';
  if (/investigat|queried|accepted|waiting|pending|awaiting/.test(name)) return 'investigating';
  return 'other';
}

let fieldCache = null;

/** The ids of the Support Rank and Product and Module fields, found by name. */
async function supportFields(credentials) {
  const key = credentials.baseUrl;
  if (fieldCache?.key === key && Date.now() - fieldCache.at < FIELD_CACHE_MS) return fieldCache.value;
  let value = { ...FALLBACK_FIELDS };
  try {
    const response = await makeHttpRequest(`${credentials.baseUrl}/rest/api/3/field`, { method: 'GET', headers: jiraHeaders(credentials) });
    const fields = Array.isArray(response.data) ? response.data : [];
    const idOf = name => fields.find(field => String(field.name || '').toLowerCase() === name)?.id;
    value = {
      supportRank: idOf('support rank') || FALLBACK_FIELDS.supportRank,
      productModule: idOf('product and module') || FALLBACK_FIELDS.productModule
    };
  } catch { /* the usual ids are tried */ }
  fieldCache = { key, at: Date.now(), value };
  return value;
}

/** A Jira select field, plain or cascading, as its text and its child's. */
function optionParts(raw) {
  if (!raw) return { value: '', child: '' };
  if (typeof raw === 'string') return { value: raw, child: '' };
  return { value: String(raw.value || raw.name || ''), child: String(raw.child?.value || raw.child?.name || '') };
}

async function searchFilter(credentials, filterId, fieldIds) {
  const fields = ['summary', 'status', 'reporter', 'assignee', 'priority', 'updated', fieldIds.supportRank, fieldIds.productModule].join(',');
  const issues = [];
  let token = '';
  do {
    const url = `${credentials.baseUrl}/rest/api/3/search/jql?jql=${encodeURIComponent(`filter = ${filterId}`)}` +
      `&maxResults=100&fields=${encodeURIComponent(fields)}${token ? `&nextPageToken=${encodeURIComponent(token)}` : ''}`;
    const response = await makeHttpRequest(url, { method: 'GET', headers: jiraHeaders(credentials) });
    issues.push(...(response.data?.issues || []));
    token = response.data?.isLast === false ? String(response.data?.nextPageToken || '') : '';
  } while (token && issues.length < MAX_TICKETS);
  return issues.slice(0, MAX_TICKETS);
}

function shapeTicket(issue, fieldIds, credentials, myAccountId) {
  const fields = issue.fields || {};
  const { value: product, child: module } = optionParts(fields[fieldIds.productModule]);
  const rawRank = fields[fieldIds.supportRank];
  const rank = rawRank === null || rawRank === undefined || rawRank === '' ? NaN : Number(rawRank);
  return {
    key: issue.key,
    url: `${credentials.baseUrl}/browse/${issue.key}`,
    summary: String(fields.summary || ''),
    status: String(fields.status?.name || ''),
    statusGroup: statusGroup(fields.status?.name),
    reporter: String(fields.reporter?.displayName || ''),
    assignee: String(fields.assignee?.displayName || ''),
    isMine: Boolean(myAccountId) && fields.assignee?.accountId === myAccountId,
    supportRank: Number.isFinite(rank) ? rank : null,
    product,
    module,
    priority: String(fields.priority?.name || ''),
    updated: String(fields.updated || '')
  };
}

let listCache = null;

export const clearSupportTicketCache = () => { listCache = null; };

function settingsView(credentials) {
  const { filterId, filterUrl } = readSettings();
  return { filterId, filterUrl, filterLink: filterUrl || `${credentials.baseUrl}/issues/?filter=${filterId}` };
}

export const tools = [
  {
    name: 'support_tickets_list',
    description: 'List the tickets in the support filter, with who reported and has them, their support rank, product, module and status',
    parameters: { type: 'object', properties: { refresh: { type: 'boolean' } }, required: [] },
    handler: async (args = {}) => {
      try {
        const credentials = resolveJiraCredentials({});
        const { filterId } = readSettings();
        const key = `${credentials.baseUrl}|${filterId}`;
        if (!args.refresh && listCache?.key === key && Date.now() - listCache.at < LIST_CACHE_MS) {
          return { success: true, ...listCache.value, settings: settingsView(credentials) };
        }
        const fieldIds = await supportFields(credentials);
        const account = await getCurrentAccount(credentials).catch(() => null);
        const issues = await searchFilter(credentials, filterId, fieldIds);
        const tickets = issues.map(issue => shapeTicket(issue, fieldIds, credentials, account?.accountId));
        const value = { tickets, fetchedAt: new Date().toISOString() };
        listCache = { key, at: Date.now(), value };
        return { success: true, ...value, settings: settingsView(credentials) };
      } catch (error) { return fail('load the support tickets', error); }
    }
  },
  {
    name: 'support_tickets_settings',
    description: 'Get or set the Jira filter the support tickets come from (a filter number or a link such as .../issues/?filter=80556)',
    parameters: { type: 'object', properties: { filter: { type: 'string' } }, required: [] },
    handler: async (args = {}) => {
      try {
        if (args.filter !== undefined) {
          const text = String(args.filter || '').trim();
          if (text === '') {
            writeSettings({});
          } else {
            const filterId = parseFilterId(text);
            if (!filterId) return { success: false, message: 'Enter a Jira filter number or a link containing filter=…' };
            writeSettings({ filterId, filterUrl: /^https?:\/\//i.test(text) ? text : '' });
          }
          clearSupportTicketCache();
        }
        let baseUrl = '';
        try { baseUrl = resolveJiraCredentials({}).baseUrl; } catch { /* Jira not set up yet */ }
        const { filterId, filterUrl } = readSettings();
        return { success: true, settings: { filterId, filterUrl, filterLink: filterUrl || (baseUrl ? `${baseUrl}/issues/?filter=${filterId}` : '') } };
      } catch (error) { return fail('save the support filter', error); }
    }
  }
];
