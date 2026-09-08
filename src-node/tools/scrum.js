/**
 * Daily scrum summary.
 *
 * Builds the "yesterday / today / blockers" report read out at stand-up from
 * time entries and notes that are already in the database, so nothing has to
 * be written twice.
 */

import { db } from '../index.js';
import { ollamaClient } from '../api/ollama-client.js';
import { localDateKey } from '../utils/dates.js';
import { previousWorkingDay } from '../utils/working-days.js';
import { plannedWorkFor } from './scrum-plan.js';
import { readSprintConfig, matchMeetingTicket } from './sprint.js';

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
 * Render planned tickets as prose.
 *
 * No duration is ever shown: planned work has no time logged against it, and
 * implying otherwise is exactly the confusion this feature has to avoid.
 */
function describePlanned(planned) {
  if (!planned || planned.length === 0) return null;
  return planned
    .map(item => {
      const summary = String(item.summary || '').trim();
      return summary ? `${item.ticket_id}: ${summary}` : item.ticket_id;
    })
    .join('; ');
}

/**
 * Compose the report without the LLM.
 *
 * This is a first-class path, not an error case: Ollama is optional throughout
 * the app, so the tab has to be useful with it switched off.
 */
function fallbackSummary(yesterday, today, blockers) {
  const describe = (day) => {
    const groups = groupByTicket(day.entries);
    if (groups.length === 0) return null;
    return groups
      .map(group => {
        const tasks = group.tasks.slice(0, 3).join(', ');
        const ticket = group.ticket === 'No ticket' ? '' : `${group.ticket}: `;
        return `${ticket}${tasks} (${formatDuration(group.minutes)})`;
      })
      .join('; ');
  };

  const parts = [];
  const past = describe(yesterday);
  parts.push(past ? `Yesterday I worked on ${past}.` : 'Yesterday I had no time logged.');

  // Wording switches on the evidence available. At stand-up the current day is
  // usually still empty, so planned work has to be able to carry the sentence
  // on its own - but once time exists it is what actually happened, and the
  // plan becomes what is still to come.
  const now = describe(today);
  const planned = describePlanned(today.planned);
  if (now && planned) parts.push(`Today I am working on ${now}, and plan to pick up ${planned}.`);
  else if (now) parts.push(`Today I am working on ${now}.`);
  else if (planned) parts.push(`Today I plan to work on ${planned}.`);
  else parts.push('Today I have nothing logged yet.');

  if (blockers.length > 0) {
    const list = blockers
      .map(b => `${b.ticket_id ? `${b.ticket_id}: ` : ''}${String(b.title || b.note).trim()}`)
      .join('; ');
    parts.push(`Blocked on ${list}.`);
  } else {
    parts.push('No blockers.');
  }

  return parts.join(' ');
}

/** Render one day as prompt context. */
function dayContext(label, day) {
  const planned = describePlanned(day.planned);
  const plannedLines = planned
    ? ['Planned but not yet started (no time logged against these):',
       ...day.planned.map(item => `- ${item.ticket_id}${item.summary ? `: ${item.summary}` : ''}`)]
    : [];

  if (day.entries.length === 0 && plannedLines.length === 0) return `${label}: nothing logged.`;

  const lines = groupByTicket(day.entries).map(
    group => `- ${group.ticket}: ${group.tasks.join(', ')} (${formatDuration(group.minutes)})`
  );
  const notes = day.notes
    .slice(0, 8)
    .map(note => `- ${note.ticket_id ? `${note.ticket_id}: ` : ''}${String(note.title || note.note).trim().slice(0, 200)}`);
  return [
    `${label} (${day.date}):`,
    ...(lines.length > 0 ? lines : ['- Nothing logged yet.']),
    ...(notes.length > 0 ? ['Notes:', ...notes] : []),
    ...plannedLines
  ].join('\n');
}

/**
 * Ask the LLM for the paragraph.
 *
 * The prompt is closed over the facts gathered above and says so explicitly,
 * because an unconstrained model will happily invent plausible-sounding work
 * that was never done - which is worse than no summary at all when it is about
 * to be read aloud to the team.
 */
async function llmSummary(yesterday, today, blockers) {
  const available = await ollamaClient.initialize();
  if (!available) return null;

  const blockerContext = blockers.length > 0
    ? blockers
        .map(b => `- ${b.ticket_id ? `${b.ticket_id}: ` : ''}${String(b.title || b.note).trim().slice(0, 200)} (raised ${b.date})`)
        .join('\n')
    : 'None.';

  const prompt = `Write a short daily stand-up update in first person, as one paragraph of 2 to 4 sentences.

Cover what was done on the previous working day, what is planned for today, and any blockers. Mention ticket numbers where given. Anything listed as planned has not been started yet, so describe it as intended work and never state or imply that time has been spent on it. Use only the facts below; do not invent work, do not add commentary, and do not use bullet points or headings. Reply with the paragraph only.

${dayContext('Previous working day', yesterday)}

${dayContext('Today', today)}

Blockers:
${blockerContext}`;

  try {
    const result = await ollamaClient.generate(prompt);
    const text = String(result?.response || '').trim();
    if (!text) return null;
    return { text, model: result.model };
  } catch {
    return null;
  }
}

export const tools = [
  {
    name: 'generate_scrum_summary',
    description: 'Build the daily stand-up report: the previous working day, today, open blockers, and a paragraph to read out',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'The "today" date; defaults to the current local date' },
        use_ai: { type: 'boolean', description: 'Use the local model to write the paragraph (default true)' }
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

        let summary = null;
        let source = 'fallback';
        if (args.use_ai !== false) {
          const generated = await llmSummary(previous, current, blockers);
          if (generated) {
            summary = generated.text;
            source = 'ai';
          }
        }
        if (!summary) summary = fallbackSummary(previous, current, blockers);

        return {
          success: true,
          yesterday: previous,
          today: current,
          blockers,
          summary,
          summarySource: source
        };
      } catch (error) {
        return { success: false, message: `Failed to build scrum summary: ${error.message}` };
      }
    }
  }
];
