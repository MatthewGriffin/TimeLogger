/**
 * Current Sprint / PI configuration.
 *
 * Recurring ceremonies (daily scrum, retro, planning...) are booked in Tempo
 * against per-PI placeholder issues named `PI<n>-<Type> <Team>`. Those keys are
 * reissued every Programme Increment, so they cannot be hardcoded — they live
 * in settings and can be re-discovered from Jira by PI number.
 *
 * Calendar sync uses the mappings here to attach a ticket to each synced
 * meeting; without one a meeting can never reach Tempo, because
 * `tempo_submit_day` only considers rows with a ticket_id.
 */
import { db } from '../index.js';
import { makeHttpRequest } from '../api/http-client.js';
import { resolveJiraCredentials, jiraHeaders } from './jira-tempo.js';

const SETTINGS_KEY = 'sprint_config';

/**
 * Built-in aliases per ceremony.
 *
 * A calendar subject rarely equals the Jira type ("Discovery Daily Scrum" vs
 * "Daily Scrum"), so each type carries the phrasings people actually use.
 * These are only defaults — every alias is editable in Settings.
 */
export const DEFAULT_TYPES = [
  { id: 'scrumOfScrums', label: 'Scrum of Scrums', jiraType: 'ScrumOfScrums',
    aliases: ['scrum of scrums', 'scrumofscrums', 'sos'] },
  { id: 'dailyScrum', label: 'Daily Scrum', jiraType: 'Daily Scrum',
    aliases: ['daily scrum', 'daily stand up', 'standup', 'stand up', 'daily'] },
  { id: 'teamMtg', label: 'Team Meeting', jiraType: 'Team Mtg',
    aliases: ['team mtg', 'team meeting', 'team sync', 'team catch up'] },
  { id: 'oneToOne', label: '1-2-1', jiraType: '1-2-1',
    aliases: ['1-2-1', '1 2 1', '121', '1:1', 'one to one', 'one on one', 'catch up'] },
  { id: 'planning', label: 'Planning', jiraType: 'Planning',
    aliases: ['pi planning', 'sprint planning', 'planning', 'refinement', 'grooming', 'backlog'] },
  { id: 'retro', label: 'Retro', jiraType: 'Retro',
    aliases: ['retrospective', 'retro'] },
  { id: 'demo', label: 'Demo', jiraType: 'Demo',
    aliases: ['system demo', 'sprint review', 'showcase', 'demo'] },
  { id: 'hackathon', label: 'Hackathon', jiraType: 'Hackathon',
    aliases: ['hackathon', 'hack day', 'hackday'] },
  { id: 'training', label: 'Training', jiraType: 'Training',
    aliases: ['training', 'workshop', 'course', 'learning'] },
  { id: 'absence', label: 'Absence', jiraType: 'Absence',
    aliases: ['absence', 'annual leave', 'out of office', 'day off', 'holiday', 'leave', 'ooo', 'pto', 'sick', 'vacation'] },
  // Deliberately last and alias-light: "art" is three letters and collides with
  // ordinary words, so it relies on strict word-boundary matching.
  { id: 'art', label: 'ART', jiraType: 'ART',
    aliases: ['agile release train', 'art sync', 'art'] }
];

const DEFAULTS = {
  piNumber: '',
  projectKey: 'TIME',
  teamLabel: '',
  defaultMeetingTicket: '',
  mappings: DEFAULT_TYPES.map(t => ({ ...t, ticketKey: '' }))
};

export function readSprintConfig() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(SETTINGS_KEY);
  if (!row) return { ...DEFAULTS, mappings: DEFAULTS.mappings.map(m => ({ ...m })) };
  let stored;
  try { stored = JSON.parse(row.value); } catch { return { ...DEFAULTS }; }

  // Merge over defaults so a config saved before a type existed still gains it.
  const byId = new Map((stored.mappings || []).map(m => [m.id, m]));
  const mappings = DEFAULT_TYPES.map(type => {
    const saved = byId.get(type.id) || {};
    byId.delete(type.id);
    return {
      ...type,
      aliases: Array.isArray(saved.aliases) && saved.aliases.length ? saved.aliases : type.aliases,
      ticketKey: typeof saved.ticketKey === 'string' ? saved.ticketKey : ''
    };
  });
  // Preserve any user-added custom rows.
  for (const extra of byId.values()) {
    if (extra && extra.id) {
      mappings.push({
        id: extra.id,
        label: extra.label || extra.id,
        jiraType: extra.jiraType || extra.label || extra.id,
        aliases: Array.isArray(extra.aliases) ? extra.aliases : [],
        ticketKey: typeof extra.ticketKey === 'string' ? extra.ticketKey : ''
      });
    }
  }

  return {
    piNumber: stored.piNumber != null ? String(stored.piNumber) : '',
    projectKey: stored.projectKey || DEFAULTS.projectKey,
    teamLabel: stored.teamLabel || '',
    defaultMeetingTicket: stored.defaultMeetingTicket || '',
    mappings
  };
}

function writeSprintConfig(config) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
    .run(SETTINGS_KEY, JSON.stringify(config));
}

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Build a word-boundary matcher for an alias.
 *
 * Separators are treated as flexible so "1-2-1", "1 2 1" and "121" all match a
 * single alias. Boundaries are mandatory: without them the alias "art" would
 * match "start" and "quarterly", silently booking unrelated meetings to the
 * ART placeholder.
 */
function aliasPattern(alias) {
  const parts = String(alias).trim().toLowerCase().split(/[\s\-_:]+/).filter(Boolean).map(escapeRegex);
  if (parts.length === 0) return null;
  const body = parts.join('[\\s\\-_:]*');
  // \b fails next to a digit-adjacent boundary, so guard with explicit
  // non-word lookarounds that behave consistently for "121" and "1-2-1".
  return new RegExp(`(?<![\\w])${body}(?![\\w])`, 'i');
}

/**
 * Resolve a meeting subject to a configured ticket.
 *
 * The longest matching alias wins, so "scrum of scrums" beats "scrum" and
 * "sprint planning" beats "planning" regardless of row order.
 */
export function matchMeetingTicket(subject, config = readSprintConfig()) {
  const text = String(subject || '').trim();
  if (!text) return null;

  let best = null;
  for (const mapping of config.mappings || []) {
    if (!mapping.ticketKey) continue;
    for (const alias of mapping.aliases || []) {
      const pattern = aliasPattern(alias);
      if (!pattern || !pattern.test(text)) continue;
      const weight = String(alias).replace(/[\s\-_:]/g, '').length;
      if (!best || weight > best.weight) {
        best = { weight, ticketKey: mapping.ticketKey, matchedAlias: alias, typeId: mapping.id, label: mapping.label };
      }
    }
  }

  if (best) return { ticketKey: best.ticketKey, matchedAlias: best.matchedAlias, typeId: best.typeId, label: best.label, source: 'alias' };
  if (config.defaultMeetingTicket) {
    return { ticketKey: config.defaultMeetingTicket, matchedAlias: null, typeId: null, label: 'Default', source: 'default' };
  }
  return null;
}

export const tools = [
  {
    name: 'sprint_get_config',
    description: 'Get the current PI/sprint configuration and meeting-to-ticket mappings',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: async () => ({ success: true, config: readSprintConfig() })
  },
  {
    name: 'sprint_save_config',
    description: 'Save the current PI/sprint configuration and meeting-to-ticket mappings',
    parameters: {
      type: 'object',
      properties: {
        piNumber: { type: 'string' },
        projectKey: { type: 'string' },
        teamLabel: { type: 'string' },
        defaultMeetingTicket: { type: 'string' },
        mappings: { type: 'array' }
      },
      required: []
    },
    handler: async (args) => {
      const current = readSprintConfig();
      const next = {
        piNumber: args.piNumber != null ? String(args.piNumber).trim() : current.piNumber,
        projectKey: args.projectKey != null ? String(args.projectKey).trim() : current.projectKey,
        teamLabel: args.teamLabel != null ? String(args.teamLabel).trim() : current.teamLabel,
        defaultMeetingTicket: args.defaultMeetingTicket != null
          ? String(args.defaultMeetingTicket).trim().toUpperCase()
          : current.defaultMeetingTicket,
        mappings: Array.isArray(args.mappings)
          ? args.mappings.map(m => ({
              id: String(m.id || '').trim(),
              label: String(m.label || m.id || '').trim(),
              jiraType: String(m.jiraType || m.label || '').trim(),
              aliases: Array.isArray(m.aliases)
                ? m.aliases.map(a => String(a).trim().toLowerCase()).filter(Boolean)
                : [],
              ticketKey: String(m.ticketKey || '').trim().toUpperCase()
            })).filter(m => m.id)
          : current.mappings
      };
      writeSprintConfig(next);
      return { success: true, config: readSprintConfig(), message: 'Sprint configuration saved' };
    }
  },
  {
    name: 'sprint_lookup_pi_tickets',
    description: 'Find the meeting placeholder issues in Jira for a PI number and map them to ceremony types',
    parameters: {
      type: 'object',
      properties: {
        piNumber: { type: 'string', description: 'PI number, e.g. 43 or PI43' },
        projectKey: { type: 'string', description: 'Jira project holding the placeholders (default TIME)' },
        teamLabel: { type: 'string', description: 'Optional team suffix filter, e.g. Discovery' }
      },
      required: ['piNumber']
    },
    handler: async (args) => {
      let credentials;
      try { credentials = resolveJiraCredentials(args); }
      catch (error) { return { success: false, message: error.message }; }

      const raw = String(args.piNumber || '').trim();
      const digits = raw.replace(/^PI/i, '').trim();
      if (!/^\d+$/.test(digits)) {
        return { success: false, message: `Invalid PI number: "${raw}". Use a number such as 43.` };
      }
      const piLabel = `PI${digits}`;
      const projectKey = String(args.projectKey || readSprintConfig().projectKey || 'TIME').trim();

      const jql = `project = ${projectKey} AND summary ~ "${piLabel}*" ORDER BY key ASC`;
      const url = `${credentials.baseUrl}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=100&fields=summary`;

      let response;
      try {
        response = await makeHttpRequest(url, { method: 'GET', headers: jiraHeaders(credentials) });
      } catch (error) {
        return { success: false, message: `Jira lookup failed: ${error.message}` };
      }

      const issues = Array.isArray(response.data?.issues) ? response.data.issues : [];
      if (issues.length === 0) {
        return {
          success: false,
          message: `No ${piLabel} meeting issues found in project ${projectKey}.`,
          piLabel, projectKey, matched: [], unmatched: []
        };
      }

      // Summaries look like "PI43-Daily Scrum Discovery"; strip the PI prefix
      // and the trailing team name to recover the ceremony type.
      const teamFilter = String(args.teamLabel || '').trim().toLowerCase();
      const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

      const matched = [];
      const unmatched = [];
      let detectedTeam = '';

      for (const issue of issues) {
        const summary = String(issue.fields?.summary || '');
        const body = summary.replace(new RegExp(`^${piLabel}\\s*[-:]?\\s*`, 'i'), '').trim();
        if (teamFilter && !body.toLowerCase().includes(teamFilter)) continue;

        const type = DEFAULT_TYPES.find(t => {
          const n = normalize(body);
          return n.startsWith(normalize(t.jiraType)) || n.startsWith(normalize(t.label));
        });

        if (type) {
          const trailing = body.slice(type.jiraType.length).trim();
          if (trailing && !detectedTeam) detectedTeam = trailing;
          matched.push({ id: type.id, label: type.label, jiraType: type.jiraType, ticketKey: issue.key, summary });
        } else {
          unmatched.push({ ticketKey: issue.key, summary });
        }
      }

      return {
        success: matched.length > 0,
        piLabel,
        piNumber: digits,
        projectKey,
        teamLabel: detectedTeam,
        matched,
        unmatched,
        count: matched.length,
        message: matched.length > 0
          ? `Found ${matched.length} ${piLabel} meeting ticket(s)${detectedTeam ? ` for ${detectedTeam}` : ''}`
          : `Found ${issues.length} ${piLabel} issue(s) but none matched a known ceremony type`
      };
    }
  },
  {
    name: 'sprint_get_unticketed_meetings',
    description: 'List synced meetings still missing a ticket for a date or date range, so the user can be asked about them',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        startDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Range start; use with endDate instead of date' },
        endDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Range end; use with startDate instead of date' }
      }
    },
    handler: async (args) => {
      try {
        // Asked on every visit, not just after a sync. A meeting left without a
        // ticket is silently dropped by tempo_submit_day, and a day that is
        // already populated never syncs again, so a sync-only prompt would
        // strand it permanently.
        const startDate = args.startDate || args.date;
        const endDate = args.endDate || args.date || args.startDate;
        if (!startDate || !endDate) {
          throw new Error('date, or startDate and endDate, required in YYYY-MM-DD format');
        }

        const rows = db.prepare(`
          SELECT id, name, date FROM daily_summary
          WHERE date BETWEEN ? AND ? AND from_calendar = 1 AND submitted = 0
            AND (ticket_id IS NULL OR TRIM(ticket_id) = '')
          ORDER BY date ASC, start_time ASC
        `).all(startDate, endDate);

        // Grouped by subject so a recurring meeting is asked about once and the
        // answer applies to every occurrence in the range.
        const bySubject = new Map();
        for (const row of rows) {
          const bucket = bySubject.get(row.name) || { subject: row.name, entryIds: [], dates: [] };
          bucket.entryIds.push(row.id);
          if (!bucket.dates.includes(row.date)) bucket.dates.push(row.date);
          bySubject.set(row.name, bucket);
        }
        const meetings = [...bySubject.values()];

        return {
          success: true,
          date: args.date || startDate,
          startDate,
          endDate,
          count: meetings.length,
          unmappedMeetings: meetings,
          message: meetings.length
            ? `${meetings.length} meeting(s) still need a ticket`
            : 'All synced meetings have a ticket'
        };
      } catch (error) {
        return { success: false, message: `Failed to read meetings: ${error.message}` };
      }
    }
  },
  {
    name: 'sprint_assign_meeting_ticket',
    description: 'Assign a ticket to synced meeting entries, optionally remembering the meeting name for future syncs',
    parameters: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'Meeting subject being assigned' },
        ticketKey: { type: 'string', description: 'Jira ticket key, e.g. TIME-449' },
        entryIds: { type: 'array', description: 'Time entry ids to update' },
        remember: { type: 'boolean', description: 'Add a keyword so future syncs match automatically' },
        keyword: { type: 'string', description: 'Keyword to remember (defaults to the subject)' }
      },
      required: ['ticketKey']
    },
    handler: async (args) => {
      const ticketKey = String(args.ticketKey || '').trim().toUpperCase();
      if (!ticketKey) return { success: false, message: 'A ticket key is required' };

      const ids = Array.isArray(args.entryIds)
        ? args.entryIds.map(Number).filter(Number.isInteger)
        : [];

      // Only unsubmitted rows may change ticket: a submitted row is already in
      // Tempo under its old key, so silently repointing it would desync them.
      let updated = 0;
      if (ids.length > 0) {
        const stmt = db.prepare('UPDATE daily_summary SET ticket_id = ? WHERE id = ? AND submitted = 0');
        const apply = db.transaction(() => {
          for (const id of ids) updated += stmt.run(ticketKey, id).changes;
        });
        apply();
      }

      let remembered = null;
      if (args.remember) {
        const keyword = String(args.keyword || args.subject || '').trim().toLowerCase();
        if (keyword) {
          const config = readSprintConfig();
          // Prefer attaching to the ceremony that already owns this ticket so
          // related keywords stay grouped instead of spawning duplicate rows.
          let target = config.mappings.find(m => m.ticketKey && m.ticketKey.toUpperCase() === ticketKey);
          if (!target) {
            const id = `custom-${keyword.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
            target = config.mappings.find(m => m.id === id);
            if (!target) {
              target = { id, label: args.subject || keyword, jiraType: '', aliases: [], ticketKey };
              config.mappings.push(target);
            }
            target.ticketKey = ticketKey;
          }
          if (!target.aliases.includes(keyword)) target.aliases.push(keyword);
          writeSprintConfig(config);
          remembered = { keyword, mappingId: target.id, label: target.label };
        }
      }

      return {
        success: true,
        ticketKey,
        updated,
        remembered,
        message: `Assigned ${ticketKey} to ${updated} entr${updated === 1 ? 'y' : 'ies'}` +
          (remembered ? `, and will match "${remembered.keyword}" automatically from now on` : '')
      };
    }
  },
  {
    name: 'sprint_preview_meeting_match',
    description: 'Show which ticket a meeting subject would be mapped to',
    parameters: {
      type: 'object',
      properties: { subject: { type: 'string' } },
      required: ['subject']
    },
    handler: async (args) => {
      const match = matchMeetingTicket(args.subject);
      return {
        success: true,
        subject: args.subject,
        matched: Boolean(match),
        ticketKey: match?.ticketKey || null,
        label: match?.label || null,
        matchedAlias: match?.matchedAlias || null,
        source: match?.source || 'none'
      };
    }
  }
];
