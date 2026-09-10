/**
 * Jira/Tempo API tools
 * 
 * Tools for managing work logs with Jira/Tempo:
 * - tempo_verify_connection
 * - tempo_get_work_attributes
 * - tempo_get_issues
 * - tempo_get_recent_issues
 * - tempo_post_worklog
 * - tempo_update_worklog
 * - tempo_delete_worklog
 * - tempo_submit_day
 * 
 * Credentials are passed from frontend Settings via API calls.
 * No vault/SecretStore dependencies - everything comes from config.
 */

import { makeHttpRequest } from '../api/http-client.js';
import { db } from '../index.js';
import { timeToMinutes, minutesToTime } from '../utils/time-ranges.js';
import { takeDuplicateWorklog } from './tempo-duplicate-detection.js';
import {
  buildBasicAuth,
  resolveTempoToken,
  resolveJiraCredentials,
  jiraHeaders,
  searchIssues,
  getCurrentAccount,
  escapeJql,
  ISSUE_KEY_PATTERN,
  toSearchTerms,
  scoreIssue
} from './jira-tempo-auth.js';
import {
  fetchWorkAttributes,
  getActivityTypeValues,
  resolveActivityType
} from './jira-tempo-activity.js';
import {
  daysAhead,
  learnFutureLimit,
  readFutureLimit,
  writeFutureLimit,
  isoDaysFromToday,
  classifyWorklogFailure
} from './jira-tempo-future.js';
import {
  fetchTempoWorklogs,
  updateTempoWorklogTimes,
  isConnectivityError
} from './jira-tempo-worklogs.js';
import { readSprintConfig } from './sprint.js';

export { takeDuplicateWorklog, resolveJiraCredentials, jiraHeaders, daysAhead, learnFutureLimit, isoDaysFromToday, classifyWorklogFailure };

export const tools = [
  {
    name: 'tempo_get_future_limit',
    description: 'Return how many days ahead Tempo will accept worklogs, as learned from its own responses',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
      const maxDaysAhead = readFutureLimit();
      return {
        success: true,
        // Null means nothing has been learned yet, so callers should offer
        // every entry rather than guessing a window and hiding valid work.
        maxDaysAhead,
        // The first date Tempo refuses, and the last one it accepts. Both are
        // returned so callers never have to do off-by-one arithmetic on a
        // boundary that decides whether work is shown as submittable.
        cutoffDate: maxDaysAhead === null ? null : isoDaysFromToday(maxDaysAhead + 1),
        lastAcceptedDate: maxDaysAhead === null ? null : isoDaysFromToday(maxDaysAhead)
      };
    }
  },
  {
    name: 'tempo_verify_connection',
    description: 'Test Jira and Tempo API connectivity with provided credentials',
    parameters: {
      type: 'object',
      properties: {
        baseUrl: { type: 'string', description: 'Jira base URL (e.g., https://your-domain.atlassian.net)' },
        email: { type: 'string', description: 'Jira user email' },
        apiToken: { type: 'string', description: 'Jira API token' },
        tempoToken: { type: 'string', description: 'Tempo API token (optional)' }
      },
      required: ['baseUrl', 'email', 'apiToken']
    },
    handler: async (args) => {
      try {
        if (!args.baseUrl || !args.email || !args.apiToken) {
          throw new Error('Missing required credentials: baseUrl, email, apiToken');
        }

        const b64 = buildBasicAuth(args.email, args.apiToken);
        
        // Test Jira connection
        const jiraResp = await makeHttpRequest(`${args.baseUrl}/rest/api/3/myself`, {
          method: 'GET',
          headers: {
            'Authorization': `Basic ${b64}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (!jiraResp.data?.accountId) {
          throw new Error('Jira did not return an account ID');
        }
        
        // Test Tempo connection if token provided
        if (args.tempoToken) {
          await makeHttpRequest(
            `https://api.tempo.io/4/worklogs/user/${encodeURIComponent(jiraResp.data.accountId)}?limit=1`,
            {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${args.tempoToken}`,
                'Content-Type': 'application/json'
              }
            }
          );
        }
        
        return {
          success: true,
          message: `✅ Jira: ${jiraResp.data?.displayName} (${jiraResp.data?.emailAddress || args.email})\n✅ ${args.tempoToken ? 'Tempo: Connected' : 'Tempo: Not configured (optional)'}`
        };
      } catch (error) {
        return {
          success: false,
          message: `Connection failed: ${error.message}`
        };
      }
    }
  },
  {
    name: 'jira_find_ticket',
    description: "Find the Jira ticket matching a task name, restricted to issues the authenticated user is involved with",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Task name or text to search for' },
        limit: { type: 'number', description: 'Max matches to return (default: 5)' },
        withinDays: { type: 'number', description: 'How far back to count "recently worked on" (default: 180)' }
      },
      required: ['query']
    },
    handler: async (args) => {
      try {
        const query = String(args.query || '').trim();
        if (!query) {
          return { success: false, message: 'Enter a task name to search for', matches: [], count: 0 };
        }

        const credentials = resolveJiraCredentials(args);
        const limit = args.limit || 5;

        // An explicit key needs no search: fetch it directly so a pasted
        // reference always resolves, even to an issue the user has never
        // touched.
        const explicitKey = query.toUpperCase().match(ISSUE_KEY_PATTERN);
        if (explicitKey) {
          const issues = await searchIssues(credentials, `key = "${escapeJql(explicitKey[1])}"`, { limit: 1 });
          if (issues.length > 0) {
            const match = {
              key: issues[0].key,
              summary: issues[0].fields?.summary || '',
              status: issues[0].fields?.status?.name || '',
              confidence: 1
            };
            return {
              success: true,
              message: `Found ${match.key}`,
              matches: [match],
              bestMatch: match,
              count: 1,
              query
            };
          }
        }

        const account = await getCurrentAccount(credentials);
        const id = escapeJql(account.accountId);
        const withinDays = args.withinDays || 180;

        // Ceremony placeholder tickets (e.g. TIME-449 for the daily scrum)
        // live in a shared project and are rarely assigned/reported by the
        // searching user, so they would otherwise never surface here — but a
        // user must be able to re-point a meeting at a different one of
        // these when ceremonies get renumbered or reassigned.
        const projectKey = String(readSprintConfig().projectKey || '').trim();
        const projectClause = projectKey ? ` OR project = "${escapeJql(projectKey)}"` : '';

        // Restrict to issues this account is involved with: assigned to,
        // reported by, or recently updated by them — plus the ceremony
        // placeholder project above.
        const scope =
          `(assignee = "${id}" OR reporter = "${id}" OR issue in updatedBy("${id}", "-${withinDays}d")${projectClause})`;

        const terms = toSearchTerms(query);
        const attempts = [];
        if (terms.length > 0) {
          attempts.push(`${scope} AND summary ~ "${escapeJql(terms.join(' '))}" ORDER BY updated DESC`);
          attempts.push(`${scope} AND text ~ "${escapeJql(terms.join(' '))}" ORDER BY updated DESC`);
          // Widen to any single term so a partly-remembered name still matches.
          const anyTerm = terms.map(t => `summary ~ "${escapeJql(t)}"`).join(' OR ');
          attempts.push(`${scope} AND (${anyTerm}) ORDER BY updated DESC`);
        } else {
          attempts.push(`${scope} ORDER BY updated DESC`);
        }

        let issues = [];
        for (const jql of attempts) {
          issues = await searchIssues(credentials, jql, { limit });
          if (issues.length > 0) break;
        }

        const matches = issues
          .map(issue => ({
            key: issue.key,
            summary: issue.fields?.summary || '',
            status: issue.fields?.status?.name || '',
            confidence: Number(scoreIssue(issue.fields?.summary, query).toFixed(2))
          }))
          .sort((a, b) => b.confidence - a.confidence);

        if (matches.length === 0) {
          return {
            success: true,
            message: `No Jira tickets found for "${query}" in your assigned, reported or recently updated issues`,
            matches: [],
            count: 0,
            query,
            account: account.email
          };
        }

        return {
          success: true,
          message: `Found ${matches.length} matching ticket(s)`,
          matches,
          bestMatch: matches[0],
          count: matches.length,
          query,
          account: account.email
        };
      } catch (error) {
        return {
          success: false,
          message: `Jira ticket lookup failed: ${error.message}`,
          matches: [],
          count: 0
        };
      }
    }
  },
  {
    name: 'tempo_get_work_attributes',
    description: 'Fetch all work attributes configured in Tempo, including valid values for Activity Type',
    parameters: {
      type: 'object',
      properties: {
        tempoToken: { type: 'string', description: 'Tempo API token (falls back to Settings)' }
      },
      required: []
    },
    handler: async (args) => {
      try {
        const tempoToken = resolveTempoToken(args);

        const attrs = await fetchWorkAttributes(tempoToken);
        
        if (attrs.length === 0) {
          return {
            success: true,
            message: 'No work attributes found',
            attributes: [],
            activityTypes: []
          };
        }
        
        const attributes = attrs.map((a) => ({
          id: a.key,
          label: a.name,
          required: a.required || false,
          values: a.names ? Object.entries(a.names).map(([id, name]) => ({ id, name })) : []
        }));
        
        // Flat convenience list: activity type is the only attribute the UI
        // needs, and digging through attributes[].values at every call site
        // invites shape drift.
        const activityAttr = attributes.find(a => a.id === '_ActivityType_');

        return {
          success: true,
          attributes,
          activityTypes: activityAttr ? activityAttr.values : [],
          activityTypeRequired: activityAttr ? activityAttr.required : false,
          count: attributes.length
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to fetch work attributes: ${error.message}`
        };
      }
    }
  },
  {
    name: 'tempo_get_issues',
    description: 'Search for Jira issues by JQL query or fetch recent issues',
    parameters: {
      type: 'object',
      properties: {
        baseUrl: { type: 'string', description: 'Jira base URL' },
        email: { type: 'string', description: 'Jira user email' },
        apiToken: { type: 'string', description: 'Jira API token' },
        query: { type: 'string', description: 'JQL query (e.g., "project = TIME AND assignee = currentUser()")' },
        limit: { type: 'number', description: 'Max results (default: 10)' }
      },
      required: []
    },
    handler: async (args) => {
      try {
        const credentials = resolveJiraCredentials(args);
        const limit = args.limit || 10;
        const jql = args.query || 'assignee = currentUser() ORDER BY updated DESC';

        const issues = (await searchIssues(credentials, jql, { limit })).map(issue => ({
          key: issue.key,
          summary: issue.fields?.summary,
          status: issue.fields?.status?.name
        }));

        return {
          success: true,
          issues,
          count: issues.length
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to search issues: ${error.message}`
        };
      }
    }
  },
  {
    name: 'tempo_get_recent_issues',
    description: 'Get user\'s recent or assigned Jira issues',
    parameters: {
      type: 'object',
      properties: {
        baseUrl: { type: 'string', description: 'Jira base URL' },
        email: { type: 'string', description: 'Jira user email' },
        apiToken: { type: 'string', description: 'Jira API token' },
        limit: { type: 'number', description: 'Max issues (default: 5)' }
      },
      required: []
    },
    handler: async (args) => {
      try {
        const credentials = resolveJiraCredentials(args);
        const limit = args.limit || 5;

        const issues = (await searchIssues(
          credentials,
          'assignee = currentUser() ORDER BY updated DESC',
          { limit }
        )).map(issue => ({
          key: issue.key,
          summary: issue.fields?.summary,
          status: issue.fields?.status?.name
        }));

        return {
          success: true,
          issues,
          count: issues.length,
          limit
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to fetch recent issues: ${error.message}`
        };
      }
    }
  },
  {
    name: 'tempo_post_worklog',
    description: 'Submit a single work entry to Tempo',
    parameters: {
      type: 'object',
      properties: {
        baseUrl: { type: 'string', description: 'Jira base URL' },
        email: { type: 'string', description: 'Jira user email' },
        apiToken: { type: 'string', description: 'Jira API token' },
        tempoToken: { type: 'string', description: 'Tempo API token' },
        issueKey: { type: 'string', pattern: '^[A-Z][A-Z0-9]+-[0-9]+$', description: 'Jira issue key (e.g., TIME-359)' },
        startDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Date in YYYY-MM-DD format' },
        startTime: { type: 'string', description: 'Time in HH:MM:SS format (default: 09:00:00)' },
        timeSpentSeconds: { type: 'number', exclusiveMinimum: 0, description: 'Duration in seconds' },
        description: { type: 'string', description: 'Work description' },
        activityTypeId: { type: 'string', description: 'Tempo activity type UUID' },
        allowDuplicates: { type: 'boolean', description: 'Skip the check against worklogs already in Tempo (default false)' }
      },
      required: ['baseUrl', 'email', 'apiToken', 'tempoToken', 'issueKey', 'startDate', 'timeSpentSeconds']
    },
    handler: async (args) => {
      try {
        if (!args.baseUrl || !args.email || !args.apiToken || !args.tempoToken) {
          throw new Error('Missing required credentials');
        }

        const b64 = buildBasicAuth(args.email, args.apiToken);
        
        // Resolve issue ID
        const issueResp = await makeHttpRequest(`${args.baseUrl}/rest/api/3/issue/${args.issueKey}?fields=id`, {
          method: 'GET',
          headers: {
            'Authorization': `Basic ${b64}`,
            'Content-Type': 'application/json'
          }
        });
        
        const issueId = Number(issueResp.data?.id);
        if (!Number.isSafeInteger(issueId)) {
          throw new Error(`Invalid issue ID returned for ${args.issueKey}`);
        }
        
        // Get account ID
        const myselfResp = await makeHttpRequest(`${args.baseUrl}/rest/api/3/myself`, {
          method: 'GET',
          headers: {
            'Authorization': `Basic ${b64}`,
            'Content-Type': 'application/json'
          }
        });
        
        const accountId = myselfResp.data?.accountId;
        if (!accountId) {
          throw new Error('Could not determine account ID');
        }
        
        // Post worklog
        const startTime = args.startTime || '09:00:00';

        // Same guard as the batch path: a caller retrying after a lost
        // response must not book the time twice.
        if (args.allowDuplicates !== true) {
          let pool;
          try {
            pool = await fetchTempoWorklogs(
              { baseUrl: args.baseUrl, email: args.email, apiToken: args.apiToken },
              args.tempoToken, accountId, args.startDate, args.startDate
            );
          } catch (error) {
            return {
              success: false,
              verificationFailed: true,
              code: 'tempo_verification_failed',
              detail: error.message,
              message: `Couldn't reach Tempo to check what's already logged for ${args.startDate}, ` +
                `so nothing was submitted. This usually means Tempo is unavailable. ` +
                `Check Tempo, then try again later.`
            };
          }
          const duplicate = takeDuplicateWorklog({
            ticket_id: args.issueKey,
            start_time: startTime.slice(0, 5),
            duration_mins: Math.round(args.timeSpentSeconds / 60),
            name: args.description || ''
          }, pool, issueId);
          if (duplicate) {
            return {
              success: false,
              duplicate: true,
              worklogId: duplicate.worklog.worklogId,
              reason: duplicate.reason,
              message: `Not posted: ${args.issueKey} on ${args.startDate} is ${duplicate.detail.toLowerCase()} ` +
                `(worklog ${duplicate.worklog.worklogId})`
            };
          }
        }

        const body = {
          issueId,
          timeSpentSeconds: args.timeSpentSeconds,
          startDate: args.startDate,
          startTime,
          authorAccountId: accountId,
          description: args.description || ''
        };
        
        if (args.activityTypeId) {
          body.attributes = [{ key: '_ActivityType_', value: args.activityTypeId }];
        }
        
        const tempoResp = await makeHttpRequest('https://api.tempo.io/4/worklogs', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${args.tempoToken}`,
            'Content-Type': 'application/json'
          },
          body
        });
        
        const worklogId = tempoResp.data?.tempoWorklogId;
        if (!worklogId) {
          throw new Error('Tempo did not return a worklog ID');
        }
        
        return {
          success: true,
          message: `Worklog posted`,
          worklogId
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to post worklog: ${error.message}`
        };
      }
    }
  },
  {
    name: 'tempo_update_worklog',
    description: 'Modify an existing Tempo worklog by ID',
    parameters: {
      type: 'object',
      properties: {
        tempoToken: { type: 'string', description: 'Tempo API token' },
        worklogId: { type: 'string', description: 'Tempo worklog ID' },
        timeSpentSeconds: { type: 'number', description: 'New duration in seconds' },
        description: { type: 'string', description: 'Updated description' }
      },
      required: ['tempoToken', 'worklogId']
    },
    handler: async (args) => {
      try {
        if (!args.tempoToken) {
          throw new Error('Tempo API token is required');
        }

        const body = {};
        if (args.timeSpentSeconds !== undefined) {
          body.timeSpentSeconds = args.timeSpentSeconds;
        }
        if (args.description !== undefined) {
          body.description = args.description;
        }
        
        await makeHttpRequest(`https://api.tempo.io/4/worklogs/${args.worklogId}`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${args.tempoToken}`,
            'Content-Type': 'application/json'
          },
          body
        });
        
        return {
          success: true,
          message: 'Worklog updated'
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to update worklog: ${error.message}`
        };
      }
    }
  },
  {
    name: 'tempo_delete_worklog',
    description: 'Remove a worklog from Tempo by ID',
    parameters: {
      type: 'object',
      properties: {
        tempoToken: { type: 'string', description: 'Tempo API token' },
        worklogId: { type: 'string', description: 'Tempo worklog ID to delete' }
      },
      required: ['tempoToken', 'worklogId']
    },
    handler: async (args) => {
      try {
        if (!args.tempoToken) {
          throw new Error('Tempo API token is required');
        }

        await makeHttpRequest(`https://api.tempo.io/4/worklogs/${args.worklogId}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${args.tempoToken}`,
            'Content-Type': 'application/json'
          }
        });
        
        return {
          success: true,
          message: 'Worklog deleted'
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to delete worklog: ${error.message}`
        };
      }
    }
  },
  {
    name: 'tempo_submit_day',
    description: 'Batch submit unsubmitted entries for a date to Tempo, with a per-entry activity type',
    parameters: {
      type: 'object',
      properties: {
        baseUrl: { type: 'string', description: 'Jira base URL (falls back to Settings)' },
        email: { type: 'string', description: 'Jira user email (falls back to Settings)' },
        apiToken: { type: 'string', description: 'Jira API token (falls back to Settings)' },
        tempoToken: { type: 'string', description: 'Tempo API token (falls back to Settings)' },
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Date in YYYY-MM-DD format' },
        entryIds: { type: 'array', description: 'Optional: only submit these entry ids' },
        activityTypeId: { type: 'string', description: 'Optional: force one activity type for every entry' },
        activityTypeMap: { type: 'object', description: 'Optional: map of entry id to activity type UUID' },
        autoActivityType: { type: 'boolean', description: 'Determine the activity type per entry (default true)' },
        allowDuplicates: { type: 'boolean', description: 'Skip the check against worklogs already in Tempo (default false)' }
      },
      required: ['date']
    },
    handler: async (args) => {
      try {
        const credentials = resolveJiraCredentials(args);
        const tempoToken = resolveTempoToken(args);
        const b64 = buildBasicAuth(credentials.email, credentials.apiToken);

        // Get account ID
        const myselfResp = await makeHttpRequest(`${credentials.baseUrl}/rest/api/3/myself`, {
          method: 'GET',
          headers: {
            'Authorization': `Basic ${b64}`,
            'Content-Type': 'application/json'
          }
        });
        
        const accountId = myselfResp.data?.accountId;
        if (!accountId) {
          throw new Error('Could not determine account ID');
        }
        
        // Get unsubmitted entries for the date. A blank ticket is treated the
        // same as NULL: a whitespace-only value is just as unsubmittable.
        const dayEntries = db.prepare(`
          SELECT * FROM daily_summary
          WHERE date = ? AND submitted = 0
          ORDER BY start_time ASC
        `).all(args.date);

        const hasTicket = (entry) => entry.ticket_id !== null && String(entry.ticket_id).trim() !== '';

        // Only the entries the user ticked, when a selection was sent.
        const wanted = Array.isArray(args.entryIds) && args.entryIds.length > 0
          ? new Set(args.entryIds.map(Number))
          : null;
        const requested = wanted ? dayEntries.filter(entry => wanted.has(entry.id)) : dayEntries;

        let entries = requested.filter(hasTicket);

        // Reported rather than dropped. Breaks such as Lunch have no ticket and
        // can never reach Tempo, so silently discarding them made the caller
        // overstate how much time was actually booked.
        const skippedEntries = requested.filter(entry => !hasTicket(entry)).map(entry => ({
          id: entry.id,
          name: entry.name,
          durationMins: entry.duration_mins,
          reason: 'No ticket'
        }));

        if (entries.length === 0) {
          return {
            success: true,
            message: skippedEntries.length
              ? `No submittable entries for ${args.date}: ` +
                `${skippedEntries.length} have no ticket (${skippedEntries.map(e => e.name).join(', ')})`
              : `No unsubmitted entries for ${args.date}`,
            count: 0,
            worklogs: [],
            duplicates: 0,
            duplicateEntries: [],
            failedEntries: [],
            skipped: skippedEntries.length,
            skippedEntries
          };
        }

        // Activity Type is required by Tempo, and a day mixes meetings, dev and
        // support work, so each entry is classified on its own rather than
        // forcing one type across the whole day.
        const activityMap = args.activityTypeMap && typeof args.activityTypeMap === 'object'
          ? args.activityTypeMap
          : {};
        let activityValues = [];
        const needsLookup = !args.activityTypeId || Object.keys(activityMap).length > 0 || args.autoActivityType !== false;
        if (needsLookup) {
          try { activityValues = await getActivityTypeValues(tempoToken); }
          catch { activityValues = []; }
        }

        const resolvedFor = async (entry) => {
          const explicit = activityMap[entry.id] ?? activityMap[String(entry.id)];
          if (explicit) return { id: explicit, name: null, source: 'explicit' };
          if (args.activityTypeId) return { id: args.activityTypeId, name: null, source: 'fixed' };
          if (args.autoActivityType === false || activityValues.length === 0) return null;
          return resolveActivityType(entry.name, activityValues, {
            useLlm: true,
            fromCalendar: Boolean(entry.from_calendar),
            isHoliday: Boolean(entry.is_holiday)
          });
        };

        // Consult Tempo before posting anything. Creating a duplicate worklog
        // costs the user a manual cleanup in Tempo, so verification failing is
        // treated as a reason to stop rather than to guess.
        const checkDuplicates = args.allowDuplicates !== true;
        let duplicatePool = [];
        if (checkDuplicates) {
          try {
            duplicatePool = await fetchTempoWorklogs(
              credentials, tempoToken, accountId, args.date, args.date
            );
          } catch (error) {
            // Tempo could not be read, so there is no way to tell what is
            // already booked. Stopping leaves the day submittable; guessing
            // could double-book it and need manual cleanup in Tempo.
            return {
              success: false,
              verificationFailed: true,
              code: 'tempo_verification_failed',
              count: 0,
              date: args.date,
              detail: error.message,
              message: `Couldn't reach Tempo to check what's already logged for ${args.date}, ` +
                `so nothing was submitted. This usually means Tempo is unavailable. ` +
                `Check Tempo, then try again later — your entries are unchanged.`,
              worklogs: [],
              duplicates: 0,
              duplicateEntries: [],
              failedEntries: [],
              skipped: skippedEntries.length,
              skippedEntries
            };
          }
        }

        // Post each entry
        const results = [];
        const failedEntries = [];
        const duplicateEntries = [];

        // A ticket is commonly logged against several times in one day, and a
        // key always maps to the same numeric id, so resolve each key once per
        // submission rather than once per entry.
        const issueIdCache = new Map();
        const resolveIssueId = async (ticketKey) => {
          if (issueIdCache.has(ticketKey)) return issueIdCache.get(ticketKey);

          const issueResp = await makeHttpRequest(`${credentials.baseUrl}/rest/api/3/issue/${ticketKey}?fields=id`, {
            method: 'GET',
            headers: {
              'Authorization': `Basic ${b64}`,
              'Content-Type': 'application/json'
            }
          });

          const resolved = Number(issueResp.data?.id);
          // Only successful lookups are cached; a transient failure throws and
          // is handled per entry, leaving the next entry free to retry.
          if (Number.isSafeInteger(resolved)) issueIdCache.set(ticketKey, resolved);
          return resolved;
        };

        for (const entry of entries) {
          try {
            const issueId = await resolveIssueId(entry.ticket_id);
            if (!Number.isSafeInteger(issueId)) {
              failedEntries.push({ id: entry.id, name: entry.name, reason: 'Invalid issue ID' });
              continue;
            }

            // Checked here rather than before the loop so the comparison can
            // use the resolved numeric issue id.
            const duplicate = checkDuplicates
              ? takeDuplicateWorklog(entry, duplicatePool, issueId)
              : null;
            if (duplicate) {
              // The work is in Tempo; only this app's record of it was wrong.
              // Correcting the flag stops it being offered for submission again.
              db.prepare('UPDATE daily_summary SET submitted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(entry.id);

              // A meeting resolved as split-attendance (or otherwise edited)
              // after it was first logged has times that no longer match what
              // Tempo holds. The local entry is the source of truth, so the
              // worklog is corrected in place rather than left stale.
              const localStart = entry.start_time
                ? entry.start_time.slice(0, 5)
                : null;
              const timesDiffer = (localStart && localStart !== duplicate.worklog.startTime) ||
                entry.duration_mins !== duplicate.worklog.durationMins;

              let updated = false;
              if (timesDiffer) {
                try {
                  const updateStartTime = entry.start_time
                    ? (entry.start_time.length === 5 ? `${entry.start_time}:00` : entry.start_time)
                    : '09:00:00';
                  await updateTempoWorklogTimes(duplicate.worklog.worklogId, tempoToken, {
                    startDate: args.date,
                    startTime: updateStartTime,
                    timeSpentSeconds: entry.duration_mins * 60
                  });
                  updated = true;
                } catch {
                  // Falling behind on this one worklog should not block the
                  // rest of the day's submission.
                  updated = false;
                }
              }

              duplicateEntries.push({
                id: entry.id,
                name: entry.name,
                ticketId: entry.ticket_id,
                durationMins: entry.duration_mins,
                worklogId: duplicate.worklog.worklogId,
                reason: duplicate.reason,
                detail: duplicate.detail,
                timesUpdated: updated,
                previousStartTime: duplicate.worklog.startTime,
                previousDurationMins: duplicate.worklog.durationMins
              });
              continue;
            }
            
            // Tempo requires HH:MM:SS; entries are stored as HH:MM.
            const startTime = entry.start_time
              ? (entry.start_time.length === 5 ? `${entry.start_time}:00` : entry.start_time)
              : '09:00:00';

            const body = {
              issueId,
              timeSpentSeconds: entry.duration_mins * 60,
              startDate: args.date,
              startTime,
              authorAccountId: accountId,
              description: entry.name
            };

            const activity = await resolvedFor(entry);
            if (activity?.id) {
              body.attributes = [{ key: '_ActivityType_', value: activity.id }];
            }
            
            const tempoResp = await makeHttpRequest('https://api.tempo.io/4/worklogs', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${tempoToken}`,
                'Content-Type': 'application/json'
              },
              body
            });
            
            const worklogId = tempoResp.data?.tempoWorklogId;
            if (!worklogId) {
              failedEntries.push({ id: entry.id, name: entry.name, reason: 'No worklog ID returned' });
              continue;
            }
            
            // Mark as submitted
            db.prepare('UPDATE daily_summary SET submitted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(entry.id);

            // Fold the new worklog into the pool so two identical local rows
            // cannot both post against the same slot in one run.
            duplicatePool.push({
              worklogId,
              issueId,
              ticketId: entry.ticket_id,
              description: entry.name,
              date: args.date,
              startTime: startTime.slice(0, 5),
              durationMins: entry.duration_mins
            });

            results.push({
              id: entry.id,
              name: entry.name,
              worklogId,
              activityTypeId: activity?.id || null,
              activityTypeName: activity?.name || null,
              activitySource: activity?.source || 'none'
            });
          } catch (error) {
            failedEntries.push({
              id: entry.id,
              name: entry.name,
              ...classifyWorklogFailure(error.message)
            });
          }
        }
        
        // Track submission history. Entries Tempo will not accept yet are not
        // failures of this run, so a day held back only by the future-logging
        // window records nothing rather than a spurious failed submission.
        const futureLimitedEntries = failedEntries.filter(e => e.futureLimited);
        const realFailures = failedEntries.length - futureLimitedEntries.length;
        const updatedEntries = duplicateEntries.filter(e => e.timesUpdated);

        // Remember what Tempo just proved about its future-logging window so
        // the Submit page can stop offering entries it would only reject.
        const offset = daysAhead(args.date);
        if (offset > 0) {
          const learned = learnFutureLimit(readFutureLimit(), {
            rejectedAt: futureLimitedEntries.length > 0 ? offset : null,
            acceptedAt: results.length > 0 ? offset : null
          });
          writeFutureLimit(learned);
        }

        if (results.length > 0 || realFailures > 0) {
          const historyStatus = realFailures === 0
            ? 'success'
            : results.length === 0 ? 'failed' : 'partial';
          db.prepare('INSERT INTO submission_history (date, count, status, failed_count) VALUES (?, ?, ?, ?)')
            .run(args.date, results.length, historyStatus, realFailures);
        }

        return {
          // Entries held back by Tempo's future window are a "not yet", so a
          // day containing only those is still a successful run.
          success: realFailures === 0,
          count: results.length,
          futureLimited: futureLimitedEntries.length,
          message: `Submitted ${results.length}/${entries.length} entries` +
            (futureLimitedEntries.length
              ? `. ${futureLimitedEntries.length} dated too far ahead for Tempo`
              : '') +
            (duplicateEntries.length
              ? `. Skipped ${duplicateEntries.length} already in Tempo (${duplicateEntries.map(e => e.name).join(', ')})` +
                (updatedEntries.length
                  ? `, updated ${updatedEntries.length} whose time had changed (${updatedEntries.map(e => e.name).join(', ')})`
                  : '')
              : '') +
            (skippedEntries.length
              ? `. Skipped ${skippedEntries.length} with no ticket (${skippedEntries.map(e => e.name).join(', ')})`
              : ''),
          worklogs: results,
          duplicates: duplicateEntries.length,
          duplicateEntries,
          updated: updatedEntries.length,
          updatedEntries,
          failedEntries,
          skipped: skippedEntries.length,
          skippedEntries
        };
      } catch (error) {
        // Everything in this block runs before any worklog is posted, so a
        // failure here means nothing was submitted. Connectivity problems are
        // reported with the same guidance as a failed duplicate check: the
        // user cannot act on "ECONNREFUSED", only on "Tempo looks down".
        if (isConnectivityError(error)) {
          return {
            success: false,
            verificationFailed: true,
            code: 'tempo_verification_failed',
            count: 0,
            date: args.date,
            detail: error.message,
            message: `Couldn't reach Jira/Tempo to check what's already logged for ${args.date}, ` +
              `so nothing was submitted. This usually means the service is unavailable. ` +
              `Check Tempo, then try again later — your entries are unchanged.`,
            worklogs: [],
            duplicates: 0,
            duplicateEntries: [],
            failedEntries: [],
            skipped: 0,
            skippedEntries: []
          };
        }
        return {
          success: false,
          message: `Failed to submit day: ${error.message}`
        };
      }
    }
  },
  {
    name: 'tempo_get_worklogs',
    description: 'Read the worklogs actually recorded in Tempo for a date range and reconcile them against local entries',
    parameters: {
      type: 'object',
      properties: {
        baseUrl: { type: 'string', description: 'Jira base URL (falls back to Settings)' },
        email: { type: 'string', description: 'Jira user email (falls back to Settings)' },
        apiToken: { type: 'string', description: 'Jira API token (falls back to Settings)' },
        tempoToken: { type: 'string', description: 'Tempo API token (falls back to Settings)' },
        from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Start date (inclusive)' },
        to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'End date (inclusive)' }
      },
      required: ['from', 'to']
    },
    handler: async (args) => {
      try {
        const credentials = resolveJiraCredentials(args);
        const tempoToken = resolveTempoToken(args);
        const account = await getCurrentAccount(credentials);

        const worklogs = await fetchTempoWorklogs(
          credentials, tempoToken, account.accountId, args.from, args.to
        );

        // Reconcile against what the app believes it has submitted. The local
        // `submitted` flag is set when a POST succeeds but is never re-checked,
        // so it drifts whenever a worklog is edited or deleted directly in
        // Tempo. Matching on ticket + date is what surfaces that drift.
        const localEntries = db.prepare(`
          SELECT id, date, name, ticket_id, start_time, duration_mins, submitted
          FROM daily_summary
          WHERE date >= ? AND date <= ?
            AND ticket_id IS NOT NULL
            AND TRIM(ticket_id) <> ''
          ORDER BY date ASC, start_time ASC
        `).all(args.from, args.to);

        const remaining = new Map();
        for (const log of worklogs) {
          const key = `${log.date}|${log.ticketId}`;
          if (!remaining.has(key)) remaining.set(key, []);
          remaining.get(key).push(log);
        }

        const reconciled = localEntries.map(entry => {
          const key = `${entry.date}|${entry.ticket_id}`;
          const pool = remaining.get(key) || [];
          // Prefer the worklog whose duration also agrees, so a part-matched
          // pair is not consumed by an unrelated entry on the same ticket.
          let index = pool.findIndex(log => log.durationMins === entry.duration_mins);
          if (index === -1) index = pool.length > 0 ? 0 : -1;
          const match = index >= 0 ? pool.splice(index, 1)[0] : null;

          let status;
          if (match && entry.submitted) status = 'matched';
          else if (match && !entry.submitted) status = 'in_tempo_not_marked';
          else if (!match && entry.submitted) status = 'missing_from_tempo';
          else status = 'not_submitted';

          return {
            entryId: entry.id,
            date: entry.date,
            name: entry.name,
            ticketId: entry.ticket_id,
            startTime: entry.start_time,
            durationMins: entry.duration_mins,
            submitted: Boolean(entry.submitted),
            status,
            worklogId: match?.worklogId ?? null,
            tempoDurationMins: match?.durationMins ?? null,
            durationDiffers: Boolean(match && match.durationMins !== entry.duration_mins),
            activityTypeName: match?.activityTypeName ?? null
          };
        });

        const unmatchedWorklogs = [...remaining.values()].flat()
          .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));

        const totalTempoMins = worklogs.reduce((sum, w) => sum + w.durationMins, 0);
        const counts = reconciled.reduce((acc, row) => {
          acc[row.status] = (acc[row.status] || 0) + 1;
          return acc;
        }, {});

        return {
          success: true,
          from: args.from,
          to: args.to,
          worklogs,
          reconciled,
          unmatchedWorklogs,
          counts: {
            tempoWorklogs: worklogs.length,
            localEntries: localEntries.length,
            matched: counts.matched || 0,
            missingFromTempo: counts.missing_from_tempo || 0,
            inTempoNotMarked: counts.in_tempo_not_marked || 0,
            notSubmitted: counts.not_submitted || 0,
            onlyInTempo: unmatchedWorklogs.length
          },
          totalTempoMins,
          totalTempoHours: Math.round((totalTempoMins / 60) * 100) / 100,
          message: `Found ${worklogs.length} Tempo worklog(s) totalling ${(totalTempoMins / 60).toFixed(2)}h between ${args.from} and ${args.to}`
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to read Tempo worklogs: ${error.message}`
        };
      }
    }
  },
  {
    name: 'tempo_import_worklogs',
    description: 'Pull worklogs that exist only in Tempo down into local time entries',
    parameters: {
      type: 'object',
      properties: {
        baseUrl: { type: 'string', description: 'Jira base URL (falls back to Settings)' },
        email: { type: 'string', description: 'Jira user email (falls back to Settings)' },
        apiToken: { type: 'string', description: 'Jira API token (falls back to Settings)' },
        tempoToken: { type: 'string', description: 'Tempo API token (falls back to Settings)' },
        from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Start date (inclusive)' },
        to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'End date (inclusive)' },
        worklogIds: {
          type: 'array',
          items: { type: 'number' },
          description: 'Tempo worklog ids to import; omit to import every worklog in the range that has no local entry'
        }
      },
      required: ['from', 'to']
    },
    handler: async (args) => {
      try {
        const credentials = resolveJiraCredentials(args);
        const tempoToken = resolveTempoToken(args);
        const account = await getCurrentAccount(credentials);

        // Re-read from Tempo rather than trusting ids off a page that may have
        // been open for hours; a worklog deleted since then must not be
        // recreated locally.
        const worklogs = await fetchTempoWorklogs(
          credentials, tempoToken, account.accountId, args.from, args.to
        );

        const wanted = Array.isArray(args.worklogIds) && args.worklogIds.length > 0
          ? new Set(args.worklogIds.map(Number))
          : null;

        const requested = wanted
          ? worklogs.filter(log => wanted.has(Number(log.worklogId)))
          : worklogs;

        const missingIds = wanted
          ? [...wanted].filter(id => !worklogs.some(log => Number(log.worklogId) === id))
          : [];

        const localEntries = db.prepare(`
          SELECT id, date, name, ticket_id, start_time, end_time, duration_mins, submitted
          FROM daily_summary
          WHERE date >= ? AND date <= ?
        `).all(args.from, args.to);

        // Same date+ticket pairing the reconcile view uses, so anything it
        // shows as already matched is not imported a second time.
        const claimed = new Map();
        for (const entry of localEntries) {
          const key = `${entry.date}|${entry.ticket_id}`;
          if (!claimed.has(key)) claimed.set(key, []);
          claimed.get(key).push(entry);
        }

        const insert = db.prepare(`
          INSERT OR IGNORE INTO daily_summary
            (date, name, ticket_id, start_time, end_time, duration_mins, submitted, from_calendar)
          VALUES (?, ?, ?, ?, ?, ?, 1, 0)
        `);

        const imported = [];
        const skipped = [];
        const overlapped = [];

        const applyImport = db.transaction(() => {
          for (const log of requested) {
            if (!log.ticketId) {
              skipped.push({ worklogId: log.worklogId, reason: 'Worklog has no resolvable ticket' });
              continue;
            }

            const key = `${log.date}|${log.ticketId}`;
            const pool = claimed.get(key) || [];
            // Prefer an exact duration match, mirroring the reconciler, so a
            // part-matched pair is not consumed by an unrelated entry.
            const existing = pool.find(entry => entry.duration_mins === log.durationMins) || pool[0];
            if (existing) {
              // Already represented locally. Bring the flag into line with
              // Tempo rather than adding a duplicate row.
              if (!existing.submitted) {
                db.prepare(
                  'UPDATE daily_summary SET submitted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
                ).run(existing.id);
              }
              pool.splice(pool.indexOf(existing), 1);
              skipped.push({
                worklogId: log.worklogId,
                reason: existing.submitted
                  ? 'Already exists locally'
                  : 'Already exists locally; marked as submitted'
              });
              continue;
            }

            const startTime = log.startTime || '09:00';
            const endTime = minutesToTime(
              timeToMinutes(startTime) + (log.durationMins || 0)
            );
            const name = log.description?.trim()
              || log.ticketSummary?.trim()
              || log.ticketId;

            const clash = localEntries.find(entry =>
              entry.date === log.date && entry.start_time && entry.end_time &&
              timeToMinutes(entry.start_time) < timeToMinutes(endTime) &&
              timeToMinutes(entry.end_time) > timeToMinutes(startTime)
            );

            const result = insert.run(
              log.date, name, log.ticketId, startTime, endTime, log.durationMins
            );

            if (result.changes === 0) {
              // The unique index on (date, name, start_time, end_time) rejected
              // it, so an identical row is already present.
              skipped.push({ worklogId: log.worklogId, reason: 'Identical entry already exists' });
              continue;
            }

            const record = {
              id: result.lastInsertRowid,
              worklogId: log.worklogId,
              date: log.date,
              name,
              ticketId: log.ticketId,
              startTime,
              endTime,
              durationMins: log.durationMins
            };
            imported.push(record);
            localEntries.push({
              id: record.id, date: log.date, name, ticket_id: log.ticketId,
              start_time: startTime, end_time: endTime,
              duration_mins: log.durationMins, submitted: 1
            });

            // Reported, not resolved. The time is genuinely booked in Tempo, so
            // it is imported as-is; silently trimming the user's own entry to
            // make room would destroy logged work.
            if (clash) {
              overlapped.push({
                worklogId: log.worklogId,
                date: log.date,
                imported: `${startTime}-${endTime}`,
                conflictsWith: `${clash.name} (${clash.start_time}-${clash.end_time})`
              });
            }
          }
        });

        applyImport();

        const parts = [];
        if (imported.length > 0) parts.push(`Imported ${imported.length} worklog(s) from Tempo`);
        if (skipped.length > 0) parts.push(`${skipped.length} already present`);
        if (overlapped.length > 0) parts.push(`${overlapped.length} overlap an existing entry`);
        if (missingIds.length > 0) parts.push(`${missingIds.length} no longer exist in Tempo`);
        if (parts.length === 0) parts.push('Nothing to import');

        return {
          success: true,
          imported: imported.length,
          importedEntries: imported,
          skipped: skipped.length,
          skippedWorklogs: skipped,
          overlapped: overlapped.length,
          overlappedEntries: overlapped,
          missingWorklogIds: missingIds,
          message: parts.join('. ')
        };
      } catch (error) {
        return {
          success: false,
          imported: 0,
          message: `Failed to import Tempo worklogs: ${error.message}`
        };
      }
    }
  }
];
