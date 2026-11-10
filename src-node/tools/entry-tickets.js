/**
 * Suggested tickets for time entries that have none.
 *
 * An entry without a ticket can never reach Tempo, so Submit offers to fill them
 * in. This only suggests: nothing is saved here, and the caller applies a
 * suggestion once the user has approved it. Each suggestion says where it came
 * from, so the user can judge it:
 *
 *   1. keyword  - a Current Sprint keyword matches the name, such as "daily scrum"
 *   2. history  - the same name was logged to a ticket before
 *   3. ai       - the local model chose from the known tickets
 *
 * The model can only pick from a numbered list of real tickets, so it can't
 * invent a key. With Ollama off, the first two still work.
 */
import { db } from '../index.js';
import { ollamaClient } from '../api/ollama-client.js';
import { readSprintConfig, matchMeetingTicket } from './sprint.js';

const HISTORY_DAYS = 180;
const MAX_ENTRIES = 60;
const MAX_HISTORY_CANDIDATES = 15;
const MODEL_BUDGET_MS = 90000;
const MODEL_CALL_TIMEOUT_MS = 20000;

const normalizeName = (name) => String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** What a ticket is, such as "PI 44 Daily Scrum", for a time ticket. */
function timeTicketCandidates(config) {
  return (config.mappings || [])
    .filter(mapping => mapping.ticketKey)
    .map(mapping => ({
      key: String(mapping.ticketKey).trim().toUpperCase(),
      description: [config.piNumber && `PI ${config.piNumber}`, mapping.label].filter(Boolean).join(' '),
      kind: 'time'
    }));
}

/**
 * How past entries were ticketed: the ticket used most for each name, and the
 * most recently used tickets with the last name logged to them.
 */
function readHistory() {
  const rows = db.prepare(`
    SELECT name, ticket_id AS ticket, COUNT(*) AS uses, MAX(date) AS lastUsed
    FROM daily_summary
    WHERE ticket_id IS NOT NULL AND TRIM(ticket_id) != ''
      AND date >= date('now', '-${HISTORY_DAYS} days')
    GROUP BY name, ticket_id
  `).all();

  const byName = new Map();
  const byTicket = new Map();
  for (const row of rows) {
    const key = normalizeName(row.name);
    if (key) {
      const best = byName.get(key);
      if (!best || row.uses > best.uses) byName.set(key, { ticket: row.ticket.trim().toUpperCase(), uses: row.uses });
    }
    const ticket = row.ticket.trim().toUpperCase();
    const seen = byTicket.get(ticket);
    if (!seen || row.lastUsed > seen.lastUsed) byTicket.set(ticket, { name: row.name, lastUsed: row.lastUsed });
  }
  const recent = [...byTicket.entries()]
    .sort((a, b) => b[1].lastUsed.localeCompare(a[1].lastUsed))
    .map(([key, value]) => ({ key, description: value.name, kind: 'recent' }));
  return { byName, recent };
}

function missingTicketEntries(args) {
  const ids = Array.isArray(args.entryIds) ? args.entryIds.map(Number).filter(Number.isInteger) : [];
  if (ids.length === 0) return [];
  const placeholders = ids.slice(0, MAX_ENTRIES).map(() => '?').join(',');
  // Re-checked here, so a stale list can't have a submitted or ticketed entry suggested for.
  return db.prepare(`
    SELECT id, date, name FROM daily_summary
    WHERE id IN (${placeholders}) AND submitted = 0
      AND (ticket_id IS NULL OR TRIM(ticket_id) = '')
    ORDER BY date ASC, start_time ASC
  `).all(...ids.slice(0, MAX_ENTRIES));
}

/** Ask the model for one ticket from the list. Returns a candidate, or null for no good fit. */
async function askModel(name, candidates, timeoutMs) {
  const list = candidates.map((candidate, index) => `${index + 1}. ${candidate.key} - ${candidate.description}`).join('\n');
  const prompt = `A time entry needs a ticket. Choose the ticket it belongs to.\n\nEntry: "${String(name).slice(0, 200)}"\n\nTickets:\n${list}\n\nAnswer with the number of the best ticket only. Answer 0 if none of them clearly fits.`;
  const result = await ollamaClient.generate(prompt, null, { options: { temperature: 0 }, timeoutMs });
  const number = Number.parseInt(String(result?.response || '').trim().match(/\d+/)?.[0] ?? '', 10);
  return Number.isInteger(number) && number >= 1 && number <= candidates.length ? candidates[number - 1] : null;
}

export async function suggestEntryTickets(args = {}) {
  const entries = missingTicketEntries(args);
  const config = readSprintConfig();
  const timeTickets = timeTicketCandidates(config);
  const labelFor = (key) => {
    const found = timeTickets.find(ticket => ticket.key === key);
    return found ? `${found.description}`.trim() : '';
  };
  const { byName, recent } = readHistory();

  // Time tickets first, so recent tickets can't crowd them out of a small model's list.
  const known = new Set(timeTickets.map(ticket => ticket.key));
  const candidates = [
    ...timeTickets,
    ...recent.filter(ticket => !known.has(ticket.key)).slice(0, MAX_HISTORY_CANDIDATES)
  ];

  const useAi = args.useAi !== false && candidates.length > 0 && await ollamaClient.initialize();
  const deadline = Date.now() + MODEL_BUDGET_MS;
  const answers = new Map();

  const suggestions = [];
  for (const entry of entries) {
    const key = normalizeName(entry.name);
    const keyword = matchMeetingTicket(entry.name, config);
    const earlier = byName.get(key);
    let suggestion = null;

    if (keyword) {
      suggestion = { ticketKey: keyword.ticketKey.toUpperCase(), source: 'keyword', reason: `Matches the "${keyword.matchedAlias}" keyword for ${keyword.label}.` };
    } else if (earlier) {
      suggestion = { ticketKey: earlier.ticket, source: 'history', reason: `"${entry.name}" was logged to this ticket ${earlier.uses} time${earlier.uses === 1 ? '' : 's'} before.` };
    } else if (useAi && Date.now() < deadline) {
      // One question per distinct name, however many entries share it.
      if (!answers.has(key)) {
        try {
          const timeout = Math.max(1000, Math.min(MODEL_CALL_TIMEOUT_MS, deadline - Date.now()));
          answers.set(key, await askModel(entry.name, candidates, timeout));
        } catch {
          answers.set(key, null);
        }
      }
      const chosen = answers.get(key);
      if (chosen) suggestion = { ticketKey: chosen.key, source: 'ai', reason: 'Chosen by the local AI from your time tickets and recent tickets.' };
    }

    suggestions.push({
      entryId: entry.id,
      date: entry.date,
      name: entry.name,
      ticketKey: suggestion?.ticketKey ?? null,
      label: suggestion ? labelFor(suggestion.ticketKey) : '',
      source: suggestion?.source ?? null,
      reason: suggestion?.reason ?? ''
    });
  }

  return {
    success: true,
    aiAvailable: Boolean(useAi),
    suggestions,
    message: `${suggestions.filter(item => item.ticketKey).length} of ${suggestions.length} entries have a suggested ticket`
  };
}

export const tools = [
  {
    name: 'suggest_entry_tickets',
    description: 'Suggest a ticket for each given unsubmitted entry that has none, from Current Sprint keywords, earlier entries with the same name and the local AI. Nothing is saved.',
    parameters: {
      type: 'object',
      properties: {
        entryIds: { type: 'array', description: 'Ids of the entries that need a ticket' },
        useAi: { type: 'boolean', description: 'Whether the local AI may be asked when keywords and history do not match (default true)' }
      },
      required: ['entryIds']
    },
    handler: async (args) => {
      try {
        return await suggestEntryTickets(args);
      } catch (error) {
        return { success: false, message: `Could not suggest tickets: ${error.message}` };
      }
    }
  }
];
