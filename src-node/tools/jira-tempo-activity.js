import { makeHttpRequest } from '../api/http-client.js';
import { ollamaClient } from '../api/ollama-client.js';
import { searchIssues } from './jira-tempo-auth.js';

// A ticket is a support one when its type, project, labels or components say so.
const SUPPORT_TICKET = /support|4th[\s_-]?line|fourth[\s_-]?line|\bl4\b/i;
const DEFECT_TYPE = /defect|bug/i;

/**
 * What a ticket says about the work on it: 'fix' for a support defect that
 * needs a code change, 'investigation' for any other support ticket, or null
 * when it isn't a support ticket (or nothing is known about it).
 */
export function ticketSupportKind(ticket) {
  if (!ticket) return null;
  const markers = [ticket.issueType, ticket.project, ...(ticket.labels || []), ...(ticket.components || [])];
  if (!markers.some(marker => SUPPORT_TICKET.test(String(marker || '')))) return null;
  return DEFECT_TYPE.test(String(ticket.issueType || '')) ? 'fix' : 'investigation';
}

const TICKET_CACHE_MS = 10 * 60 * 1000;
const ticketCache = new Map();

/**
 * Type, project, labels and components of tickets, by key. A ticket Jira can't
 * be asked about is left out, so the entry is classified from its name instead.
 */
export async function fetchTicketInfo(credentials, keys) {
  const wanted = [...new Set((keys || []).map(key => String(key || '').trim().toUpperCase()).filter(key => /^[A-Z][A-Z0-9_]*-\d+$/.test(key)))];
  const now = Date.now();
  const result = new Map();
  const missing = [];
  for (const key of wanted) {
    const cached = ticketCache.get(key);
    if (cached && now - cached.at < TICKET_CACHE_MS) result.set(key, cached.info);
    else missing.push(key);
  }
  for (let i = 0; i < missing.length; i += 50) {
    const batch = missing.slice(i, i + 50);
    try {
      const issues = await searchIssues(credentials, `key in (${batch.join(',')})`, { limit: batch.length, fields: 'issuetype,project,labels,components' });
      for (const issue of issues) {
        const fields = issue.fields || {};
        const info = {
          issueType: fields.issuetype?.name || '',
          project: fields.project?.name || '',
          labels: Array.isArray(fields.labels) ? fields.labels : [],
          components: (fields.components || []).map(component => component.name)
        };
        ticketCache.set(String(issue.key).toUpperCase(), { at: now, info });
        result.set(String(issue.key).toUpperCase(), info);
      }
    } catch { /* classified from the entry's name instead */ }
  }
  return result;
}

export const clearTicketCache = () => ticketCache.clear();

/**
 * Fetch work attributes from Tempo
 */
export async function fetchWorkAttributes(tempoToken) {
  const response = await makeHttpRequest('https://api.tempo.io/4/work-attributes', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${tempoToken}`,
      'Content-Type': 'application/json'
    }
  });
  return response.data?.results || [];
}

/**
 * Read the Activity Type attribute and its allowed values from Tempo.
 *
 * Activity Type is a required attribute on this Tempo instance, so a worklog
 * posted without a valid value is rejected. Values are always read live rather
 * than hardcoded: the ids are per-instance UUIDs and the list is configurable.
 */
export async function getActivityTypeValues(tempoToken) {
  const attrs = await fetchWorkAttributes(tempoToken);
  const activity = attrs.find(a => a.key === '_ActivityType_');
  if (!activity?.names) return [];
  return Object.entries(activity.names).map(([id, name]) => ({ id, name }));
}

/**
 * Pick an activity type from a task name without calling the LLM.
 *
 * Matching is done against the names Tempo actually returned, so this adapts if
 * the instance is reconfigured. Returns null when nothing is confident enough,
 * leaving the decision to the LLM.
 */
export function ruleBasedActivityType(taskName, values) {
  const text = String(taskName || '').toLowerCase();
  if (!text) return null;

  const byName = (needle) => values.find(v => v.name.toLowerCase() === needle.toLowerCase());

  // Ordered most- to least-specific: "code review" must beat "review", and a
  // support fix must not be read as generic dev work.
  const rules = [
    [/\bcode review\b|\bpull request\b|\bpr\b|\breview(ing)?\b/, 'Code Review'],
    [/\bstand-?up\b|\bscrum\b|\bmeeting\b|\brefinement\b|\bretro(spective)?\b|\bplanning\b|\bcatch-?up\b|\b1:1\b|\bsync\b|\bdemo\b|\bworkshop\b|\bsession\b|\bhuddle\b/, 'Meeting'],
    [/\bqa\b|\btest(ing|s)?\b|\bregression\b|\bverif(y|ication)\b/, 'QA'],
    [/\bsupport\b.*\bfix\b|\bhotfix\b|\bbug ?fix\b|\bfix(ing|ed)?\b/, 'Support-Fix'],
    [/\binvestigat(e|ing|ion)\b|\btriage\b|\bdiagnos(e|is)\b|\broot cause\b|\bsupport\b/, 'Support-Investigation'],
    [/\bdevelop(ment|ing)?\b|\bimplement(ing|ation)?\b|\bbuild(ing)?\b|\bcod(e|ing)\b|\brefactor\b|\bapi\b|\bfeature\b|\bpair(ing)?\b|\bdeploy(ment|ing)?\b|\bspike\b|\bprototyp(e|ing)\b|\bmigrat(e|ion)\b|\bdocument(ation|ing)?\b/, 'Dev'],
    [/\blunch\b|\bbreak\b|\bholiday\b|\bannual leave\b|\btime off\b|\bsick\b/, 'N/A']
  ];

  for (const [pattern, name] of rules) {
    if (pattern.test(text)) {
      const match = byName(name);
      if (match) return { ...match, source: 'rule' };
    }
  }
  return null;
}

/**
 * Ask the LLM to choose an activity type, constrained to the allowed values.
 *
 * The reply is matched back against the real list, so a hallucinated or
 * reworded answer is rejected rather than posted to Tempo.
 */
export async function llmActivityType(taskName, values) {
  const available = await ollamaClient.initialize();
  if (!available) return null;

  const names = values.map(v => v.name);
  const prompt = `Classify this work log entry into exactly one category.

Categories: ${names.join(', ')}

Entry: "${taskName}"

Reply with the category name only, exactly as written above. No explanation.`;

  try {
    const result = await ollamaClient.generate(prompt);
    const reply = String(result?.response || '').toLowerCase();
    // Longest name first so "Support-Fix" is not shadowed by a shorter name.
    const ranked = [...values].sort((a, b) => b.name.length - a.name.length);
    const exact = ranked.find(v => reply.trim() === v.name.toLowerCase());
    if (exact) return { ...exact, source: 'llm' };
    const loose = ranked.find(v => reply.includes(v.name.toLowerCase()));
    return loose ? { ...loose, source: 'llm' } : null;
  } catch {
    return null;
  }
}

/**
 * Resolve an activity type for a task, preferring rules and falling back to the
 * LLM, then to a safe default so a submission is never blocked.
 */
export async function resolveActivityType(taskName, values, { useLlm = true, fromCalendar = false, isHoliday = false, ticket = null } = {}) {
  // Time off is not billable work of any kind.
  if (isHoliday) {
    const na = values.find(v => v.name.toLowerCase() === 'n/a');
    if (na) return { ...na, source: 'holiday' };
  }

  // An entry synced from the calendar is a meeting by definition. This beats
  // reading the subject, which is often a topic ("Cyclescheme") that looks like
  // support or dev work.
  if (fromCalendar) {
    const meeting = values.find(v => v.name.toLowerCase() === 'meeting');
    if (meeting) return { ...meeting, source: 'calendar' };
  }

  const ruled = ruleBasedActivityType(taskName, values);
  // What the work itself says (a review, a meeting, QA) stands. Otherwise a support
  // ticket decides: a defect is a fix and anything else is an investigation.
  const keepsName = ruled && ['Code Review', 'Meeting', 'QA', 'N/A'].includes(ruled.name);
  if (!keepsName) {
    const kind = ticketSupportKind(ticket);
    const wantedName = kind === 'fix' ? 'Support-Fix' : kind === 'investigation' ? 'Support-Investigation' : null;
    const byTicket = wantedName && values.find(v => v.name.toLowerCase() === wantedName.toLowerCase());
    if (byTicket) return { ...byTicket, source: 'ticket' };
  }
  if (ruled) return ruled;

  if (useLlm) {
    const guessed = await llmActivityType(taskName, values);
    if (guessed) return guessed;
  }

  const fallback = values.find(v => v.name.toLowerCase() === 'dev') || values[0];
  return fallback ? { ...fallback, source: 'default' } : null;
}
