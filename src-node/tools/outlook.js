/**
 * Outlook calendar integration tools
 */

import { getLocalCalendarEvents } from '../api/outlook-com.js';
import { db } from '../index.js';
import { splitTimeRange, timeToMinutes } from '../utils/time-ranges.js';
import { readSprintConfig, matchMeetingTicket } from './sprint.js';

// Cached responses keyed by date range (TTL: 3 minutes). Keying by range
// matters because each calendar view requests a different window.
const eventCache = new Map();
const CACHE_TTL = 3 * 60 * 1000;

function readCache(key) {
  const hit = eventCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.timestamp >= CACHE_TTL) {
    eventCache.delete(key);
    return null;
  }
  return hit.data;
}

function writeCache(key, data) {
  eventCache.set(key, { data, timestamp: Date.now() });
}

export function clearEventCache() {
  eventCache.clear();
}

/**
 * Shape a local Outlook event into the record the rest of the app consumes.
 * The COM layer already emits local dates and wall-clock times, so no timezone
 * conversion is needed here.
 */
function normalizeEvent(event) {
  const { startTime, endTime } = event;
  return {
    ...event,
    title: event.subject,
    duration: startTime && endTime ? Math.max(0, timeToMinutes(endTime) - timeToMinutes(startTime)) : 0
  };
}

/** Leading "Canceled:"/"Cancelled:" that Outlook prepends to a cancellation. */
const CANCELLED_SUBJECT_PREFIX = /^\s*cancell?ed:\s*/i;

/**
 * Remove cancelled meetings, and the original occurrences they cancel.
 *
 * A cancellation that has not been processed out of the mailbox leaves *two*
 * items in the calendar: the untouched original (isCancelled false) and a
 * "Canceled: <subject>" stub covering the same slot. Dropping only the stub
 * would still log the full original — a six-hour planning day that never
 * happened. Both halves have to go, matched on the de-prefixed subject and the
 * slot they occupy, so an unrelated meeting with a similar name is not eaten.
 */
function dropCancelledEvents(events) {
  const cancelledSlots = new Set();

  for (const event of events) {
    if (!event.isCancelled) continue;
    const subject = String(event.subject || '').replace(CANCELLED_SUBJECT_PREFIX, '').trim().toLowerCase();
    cancelledSlots.add(`${event.date}|${subject}|${event.startTime}|${event.endTime}`);
  }

  return events.filter(event => {
    if (event.isCancelled) return false;
    const subject = String(event.subject || '').trim().toLowerCase();
    return !cancelledSlots.has(`${event.date}|${subject}|${event.startTime}|${event.endTime}`);
  });
}

async function fetchEvents({ startDate, endDate, skipCache }) {
  if (!startDate || !endDate) {
    throw new Error('startDate and endDate required in YYYY-MM-DD format');
  }

  const cacheKey = `${startDate}:${endDate}`;
  if (!skipCache) {
    const cached = readCache(cacheKey);
    if (cached) return { events: cached, cached: true };
  }

  const events = dropCancelledEvents(
    (await getLocalCalendarEvents(startDate, endDate)).map(normalizeEvent)
  );

  writeCache(cacheKey, events);
  return { events, cached: false };
}

function readCalendarConfig() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'calendar_config'").get();
  if (!row) return {};
  try {
    return JSON.parse(row.value) || {};
  } catch {
    return {};
  }
}

function readAppConfig() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'app_config'").get();
  if (!row) return {};
  try {
    return JSON.parse(row.value) || {};
  } catch {
    return {};
  }
}

/**
 * Filter raw events down to the ones that are candidates for logging: not
 * cancelled, with a usable id/start/end, and matching the configured category
 * filter (if any).
 */
function buildCandidates(events, calendarConfig) {
  const filterLabel = String(calendarConfig.filterLabel || '').trim().toLowerCase();
  return events.filter(event => {
    if (event.isCancelled) return false;
    if (!event.id || !event.startTime || !event.endTime) return false;
    if (!event.isAllDay && timeToMinutes(event.endTime) <= timeToMinutes(event.startTime)) return false;
    if (filterLabel) {
      const categories = event.categories.map(category => String(category).toLowerCase());
      if (!categories.includes(filterLabel)) return false;
    }
    return true;
  });
}

/**
 * Group timed events into clusters of two or more that overlap in time.
 *
 * Used both to hold back a genuine double-booking during sync, and to let the
 * Daily Entries screen show every overlapping group for a date so a choice
 * can be revisited later, independent of whether it was already resolved.
 */
function computeOverlapClusters(timedEvents) {
  const overlaps = (a, b) => timeToMinutes(a.startTime) < timeToMinutes(b.endTime)
    && timeToMinutes(a.endTime) > timeToMinutes(b.startTime);

  const clusters = [];
  for (const event of timedEvents) {
    const cluster = clusters.find(c => c.some(member => overlaps(member, event)));
    if (cluster) cluster.push(event);
    else clusters.push([event]);
  }
  // A second pass merges clusters that only become linked through a later
  // event (A-B and B-C overlap but A-C does not); the single forward pass
  // above can otherwise leave them split in two.
  let merged = true;
  while (merged) {
    merged = false;
    merge: for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        if (clusters[i].some(a => clusters[j].some(b => overlaps(a, b)))) {
          clusters[i] = clusters[i].concat(clusters.splice(j, 1)[0]);
          merged = true;
          break merge;
        }
      }
    }
  }

  return clusters.filter(cluster => cluster.length > 1);
}

/**
 * Choices already made for a date's conflicts: whether each event was
 * attended, and any start/end override for leaving one meeting early to
 * join another.
 */
function readConflictChoices(date) {
  return new Map(
    db.prepare(`
      SELECT event_id, attended, start_time_override, end_time_override
      FROM calendar_conflict_choices WHERE date = ?
    `).all(date).map(row => [row.event_id, {
      attended: row.attended,
      startOverride: row.start_time_override || null,
      endOverride: row.end_time_override || null
    }])
  );
}

/**
 * Sync one day's meetings into time entries from an already-fetched event list.
 *
 * Split out from the tool handler so a whole month can be synced from a single
 * Outlook COM call: fetching per day would spawn ~22 PowerShell/COM round trips
 * and the event cache is keyed by range, so it would not help.
 */
export function syncDayFromEvents(date, events, calendarConfig) {
      const workday = readAppConfig().workday || {};
      const workdayStart = workday.startTime || '09:00';
      const workdayEnd = workday.endTime || '17:00';

      const candidates = buildCandidates(events, calendarConfig);

      let created = 0;
      let skipped = 0;
      let clashed = 0;
      const clashedSubjects = [];
      const adjustedEntries = [];
      const createdEntries = [];
      // Meetings with no ceremony mapping are reported so the user knows why
      // they will not appear on the Tempo submission list. Entry ids are
      // carried back so the UI can prompt for a ticket and patch them.
      const unmappedMeetings = new Map();

      // A choice the user already made on a past conflict prompt (attended /
      // did not attend, optionally with a "left early" time override) must
      // never be asked again, or every re-sync would repeat the same
      // question.
      const conflictChoices = readConflictChoices(date);
      const declinedIds = new Set(
        [...conflictChoices.entries()].filter(([, choice]) => choice.attended === 0).map(([id]) => id)
      );

      // Applying a stored override shrinks an attended meeting to the part of
      // it actually attended (e.g. left at 13:30 to join the other one), so a
      // pair resolved this way no longer overlaps and both can be logged.
      const applyOverride = (event) => {
        const choice = conflictChoices.get(event.id);
        if (!choice || choice.attended !== 1) return event;
        if (!choice.startOverride && !choice.endOverride) return event;
        return {
          ...event,
          startTime: choice.startOverride || event.startTime,
          endTime: choice.endOverride || event.endTime
        };
      };

      let workingCandidates = candidates
        .filter(event => !declinedIds.has(event.id))
        .map(applyOverride);

      /**
       * Two genuine meetings booked over the same slot cannot both be kept
       * automatically. Silently keeping only the earlier one is exactly how a
       * wrong meeting ends up on the timesheet, so any such pair is held back
       * for the user to resolve, unless a resolution (including a time split
       * for leaving one early) has already removed the overlap.
       */
      const meetingConflicts = [];
      const timedCandidates = workingCandidates.filter(event => !event.isAllDay);
      const clusters = computeOverlapClusters(timedCandidates);

      for (const cluster of clusters) {
        meetingConflicts.push({
          date,
          events: cluster.map(event => ({
            id: event.id,
            subject: event.subject,
            startTime: event.startTime,
            endTime: event.endTime
          }))
        });
      }

      const heldBackIds = new Set(meetingConflicts.flatMap(c => c.events.map(e => e.id)));
      workingCandidates = workingCandidates.filter(event => !heldBackIds.has(event.id));

      // Timed meetings claim their slots first so an all-day event (holiday,
      // leave) fills only whatever is left of the working day.
      workingCandidates.sort((a, b) => Number(a.isAllDay) - Number(b.isAllDay));

      // Lunch is not taken on a day off, so drop the auto-added break before
      // booking leave. Only the untouched auto-entry is removed: anything
      // submitted or edited by the user stays.
      if (workingCandidates.some(event => event.isTimeOff)) {
        const lunch = readAppConfig().lunch || {};
        if (lunch.enabled !== false) {
          db.prepare(`
            DELETE FROM daily_summary
            WHERE date = ? AND name = ? AND start_time = ? AND end_time = ?
              AND submitted = 0 AND from_calendar = 0
          `).run(
            date,
            lunch.name || 'Lunch',
            lunch.startTime || '12:00',
            lunch.endTime || '13:00'
          );
        }
      }

      const insert = db.prepare(`
        INSERT INTO daily_summary (date, name, ticket_id, start_time, end_time, duration_mins, from_calendar, calendar_event_id, is_holiday)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      `);

      // Ceremonies are booked against per-PI placeholder issues. Without a
      // ticket a synced meeting can never reach Tempo, because
      // tempo_submit_day only considers rows that have one.
      const sprintConfig = readSprintConfig();
      const ticketFor = (subject) => matchMeetingTicket(subject, sprintConfig)?.ticketKey || null;

      // A meeting that lands on the lunch slot must not silently delete it:
      // ensure_lunch_entry only ever creates lunch once per day, so a carved-away
      // entry would not be recreated until the app is next restarted, and would
      // then re-report the very same meeting as a "conflict" the user thought
      // they had already resolved. Lunch is excluded from carving below and the
      // meeting is split around it instead, the same way two calendar meetings
      // are already kept apart.
      const lunchName = (readAppConfig().lunch || {}).name || 'Lunch';

      /**
       * Make room for a meeting by carving it out of the work already logged.
       *
       * A meeting is a fixed commitment, so it wins the slot and any manual
       * entry it overlaps is trimmed or split around it rather than blocking
       * it. Submitted entries are left alone — that time is already booked
       * externally and must not be rewritten. The recurring lunch entry is
       * also left alone; see lunchName above.
       */
      const carveOutForMeeting = (rangeStart, rangeEnd) => {
        const meetingStart = timeToMinutes(rangeStart);
        const meetingEnd = timeToMinutes(rangeEnd);

        const conflicts = db.prepare(`
          SELECT * FROM daily_summary
          WHERE date = ? AND submitted = 0 AND from_calendar = 0 AND name != ?
            AND start_time IS NOT NULL AND end_time IS NOT NULL
        `).all(date, lunchName).filter(row => {
          const rowStart = timeToMinutes(row.start_time);
          const rowEnd = timeToMinutes(row.end_time);
          return rowStart < meetingEnd && rowEnd > meetingStart;
        });

        const adjusted = [];

        for (const row of conflicts) {
          const remaining = splitTimeRange(row.start_time, row.end_time, [
            { start_time: rangeStart, end_time: rangeEnd }
          ]);

          db.prepare('DELETE FROM daily_summary WHERE id = ?').run(row.id);

          for (const segment of remaining) {
            // The unique index on (date, name, start_time, end_time) means an
            // identical row may already exist; keeping the first is correct.
            db.prepare(`
              INSERT OR IGNORE INTO daily_summary
                (date, name, ticket_id, start_time, end_time, duration_mins, submitted, from_calendar, is_holiday)
              VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)
            `).run(
              date,
              row.name,
              row.ticket_id,
              segment.start,
              segment.end,
              segment.durationMins,
              row.is_holiday || 0
            );
          }

          adjusted.push({
            name: row.name,
            was: `${row.start_time}-${row.end_time}`,
            // No remaining segments means the meeting swallowed the entry.
            now: remaining.map(s => `${s.start}-${s.end}`).join(', ') || 'removed'
          });
        }

        return adjusted;
      };

      // Carving an entry apart is a delete plus re-inserts, so a failure
      // part-way through would destroy logged time. All-or-nothing.
      const applySync = db.transaction(() => {
      for (const event of workingCandidates) {
        const alreadySynced = db.prepare(
          'SELECT id FROM daily_summary WHERE date = ? AND calendar_event_id = ? LIMIT 1'
        ).get(date, event.id);
        if (alreadySynced) {
          skipped++;
          continue;
        }

        // An all-day event spans midnight to midnight, which is useless as
        // logged time, so book it across the configured working day instead.
        const rangeStart = event.isAllDay ? workdayStart : event.startTime;
        const rangeEnd = event.isAllDay ? workdayEnd : event.endTime;

        // A timed meeting is a fixed commitment: it takes its slot and any
        // manual entry in the way is split around it. An all-day event has no
        // real slot of its own, so it only fills time that is still free.
        let segments;
        if (event.isAllDay) {
          const existing = db.prepare('SELECT * FROM daily_summary WHERE date = ?').all(date);
          segments = splitTimeRange(rangeStart, rangeEnd, existing);
        } else {
          adjustedEntries.push(...carveOutForMeeting(rangeStart, rangeEnd));
          // Two meetings can genuinely overlap in Outlook, but time entries
          // cannot. Whichever was written first keeps its slot, so this one
          // fills only what is left.
          const blocking = db.prepare(`
            SELECT * FROM daily_summary
            WHERE date = ? AND start_time IS NOT NULL AND end_time IS NOT NULL
          `).all(date);
          segments = splitTimeRange(rangeStart, rangeEnd, blocking);
        }

        if (segments.length === 0) {
          // An all-day event with no free time left. Entries must not
          // overlap, so it cannot be added — but the user is told, rather
          // than it disappearing silently.
          clashed++;
          clashedSubjects.push(event.subject);
          continue;
        }

        segments.forEach((segment, index) => {
          const ticketKey = ticketFor(event.subject);
          const result = insert.run(
            date,
            event.subject,
            ticketKey,
            segment.start,
            segment.end,
            segment.durationMins,
            // The unique index permits one marked row per (date, event);
            // any extra split segments are stored unmarked.
            index === 0 ? event.id : null,
            event.isTimeOff ? 1 : 0
          );
          createdEntries.push({
            id: result.lastInsertRowid,
            name: event.subject,
            ticketId: ticketKey,
            startTime: segment.start,
            endTime: segment.end
          });
          if (!ticketKey) {
            const bucket = unmappedMeetings.get(event.subject)
              || { subject: event.subject, entryIds: [] };
            bucket.entryIds.push(result.lastInsertRowid);
            unmappedMeetings.set(event.subject, bucket);
          }
        });
        created++;
      }
      });

      applySync();

      // Re-syncing skips meetings already present, so a meeting left without
      // a ticket on an earlier sync would never be offered again. Sweep the
      // whole day so the prompt is repeatable rather than one-shot.
      const ticketless = db.prepare(`
        SELECT id, name FROM daily_summary
        WHERE date = ? AND from_calendar = 1 AND submitted = 0
          AND (ticket_id IS NULL OR TRIM(ticket_id) = '')
      `).all(date);
      for (const row of ticketless) {
        const bucket = unmappedMeetings.get(row.name) || { subject: row.name, entryIds: [] };
        if (!bucket.entryIds.includes(row.id)) bucket.entryIds.push(row.id);
        unmappedMeetings.set(row.name, bucket);
      }

      const parts = [];
      if (created > 0) parts.push(`Added ${created} meeting(s) to time entries`);
      if (adjustedEntries.length > 0) {
        parts.push(`Adjusted ${adjustedEntries.length} existing entr(y/ies) around meetings`);
      }
      if (clashed > 0) {
        parts.push(
          `${clashed} all-day event(s) had no free time and were not added: ${clashedSubjects.join(', ')}`
        );
      }
      if (unmappedMeetings.size > 0) {
        parts.push(
          `${unmappedMeetings.size} meeting(s) need a ticket: ` +
          `${[...unmappedMeetings.keys()].join(', ')}`
        );
      }
      if (meetingConflicts.length > 0) {
        parts.push(
          `${meetingConflicts.length} overlapping meeting(s) need you to pick which one you attended`
        );
      }
      if (parts.length === 0) parts.push('Calendar is up to date');

      return {
        success: true,
        created,
        skipped,
        clashed,
        clashedSubjects,
        adjusted: adjustedEntries.length,
        adjustedEntries,
        unmapped: unmappedMeetings.size,
        unmappedSubjects: [...unmappedMeetings.keys()],
        unmappedMeetings: [...unmappedMeetings.values()],
        meetingConflicts,
        entries: createdEntries,
        message: parts.join('. ')
      };
}

export const tools = [
  {
    name: 'get_outlook_events',
    description: 'Compatibility alias for Outlook calendar events',
    parameters: {
      type: 'object',
      properties: {
        startDate: { type: 'string' },
        endDate: { type: 'string' },
        skipCache: { type: 'boolean' }
      },
      required: ['startDate', 'endDate']
    },
    handler: async (args, context) => tools.find(tool => tool.name === 'get_outlook_events_calendar').handler(args, context)
  },
  {
    name: 'get_outlook_events_calendar',
    description: 'Fetch calendar events from Outlook for a date range',
    parameters: {
      type: 'object',
      properties: {
        startDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Start date (YYYY-MM-DD)' },
        endDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'End date (YYYY-MM-DD)' },
        skipCache: { type: 'boolean', description: 'Bypass 3-minute cache' }
      },
      required: ['startDate', 'endDate']
    },
    handler: async (args) => {
      try {
        const { events, cached } = await fetchEvents(args);
        return {
          success: true,
          message: cached
            ? 'Fetched from cache (3-minute TTL)'
            : `✅ Fetched ${events.length} event(s) from ${args.startDate} to ${args.endDate}`,
          events,
          count: events.length,
          cached
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to fetch Outlook events: ${error.message}`,
          textResultForLlm: `Failed to fetch Outlook events: ${error.message}`,
          resultType: 'failure',
          notConfigured: Boolean(error.notConfigured),
          events: [],
          count: 0
        };
      }
    }
  },
  {
    name: 'sync_calendar_events',
    description: 'Create time entries from Outlook meetings for a date; safe to run repeatedly',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Date to sync (YYYY-MM-DD)' },
        skipCache: { type: 'boolean', description: 'Bypass the event cache (default true)' }
      },
      required: ['date']
    },
    handler: async (args) => {
      try {
        // Default to today so a caller that omits the date still does something
        // sensible rather than failing.
        const date = args.date || new Date().toLocaleDateString('en-CA');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          throw new Error('date is required in YYYY-MM-DD format');
        }
        args = { ...args, date };

        const calendarConfig = readCalendarConfig();
        if (calendarConfig.enabled === false) {
          return { success: true, created: 0, skipped: 0, entries: [], message: 'Calendar sync is disabled' };
        }

        const { events } = await fetchEvents({
          startDate: args.date,
          endDate: args.date,
          skipCache: args.skipCache !== false
        });

        return syncDayFromEvents(date, events, calendarConfig);
      } catch (error) {
        return {
          success: false,
          created: 0,
          skipped: 0,
          entries: [],
          message: `Failed to sync calendar: ${error.message}`,
          notConfigured: Boolean(error.notConfigured)
        };
      }
    }
  },
  {
    name: 'resolve_meeting_conflict',
    description: 'Record which of a set of overlapping Outlook meetings the user actually attended, then re-sync the day. A resolution may include a start/end time override to represent leaving one meeting early to join another. Safe to call again later to change a previous choice.',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Date the conflict occurred on' },
        resolutions: {
          type: 'array',
          description: 'One entry per event in the conflict: whether the user attended it, and optionally the actual time attended',
          items: {
            type: 'object',
            properties: {
              eventId: { type: 'string' },
              attended: { type: 'boolean' },
              startTimeOverride: { type: 'string', description: 'Actual start time (HH:MM) if different from the meeting, e.g. joined late' },
              endTimeOverride: { type: 'string', description: 'Actual end time (HH:MM) if different from the meeting, e.g. left early' }
            },
            required: ['eventId', 'attended']
          }
        }
      },
      required: ['date', 'resolutions']
    },
    handler: async (args) => {
      try {
        const date = args.date;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
          throw new Error('date is required in YYYY-MM-DD format');
        }
        const resolutions = Array.isArray(args.resolutions) ? args.resolutions : [];
        if (resolutions.length === 0) {
          throw new Error('At least one resolution is required');
        }

        const upsert = db.prepare(`
          INSERT INTO calendar_conflict_choices
            (date, event_id, attended, start_time_override, end_time_override, updated_at)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(date, event_id) DO UPDATE SET
            attended = excluded.attended,
            start_time_override = excluded.start_time_override,
            end_time_override = excluded.end_time_override,
            updated_at = CURRENT_TIMESTAMP
        `);
        // A changed mind must not leave the old entry behind alongside the
        // new one, so any not-yet-submitted row already synced for this
        // event is cleared first and left to sync fresh. A submitted row is
        // already reported externally and is never touched here.
        const clearPrior = db.prepare(`
          DELETE FROM daily_summary WHERE date = ? AND calendar_event_id = ? AND submitted = 0
        `);
        for (const resolution of resolutions) {
          if (!resolution.eventId) continue;
          const eventId = String(resolution.eventId);
          const attended = resolution.attended ? 1 : 0;
          upsert.run(
            date,
            eventId,
            attended,
            attended && resolution.startTimeOverride ? String(resolution.startTimeOverride) : null,
            attended && resolution.endTimeOverride ? String(resolution.endTimeOverride) : null
          );
          clearPrior.run(date, eventId);
        }

        // The choices are now persisted, so re-running the normal sync for
        // the day lets each event fall through its ordinary path: an
        // attended meeting (in full or the overridden portion of it) is
        // inserted like any other, a declined one is filtered out for good.
        const calendarConfig = readCalendarConfig();
        const { events } = await fetchEvents({ startDate: date, endDate: date, skipCache: true });
        return syncDayFromEvents(date, events, calendarConfig);
      } catch (error) {
        return {
          success: false,
          created: 0,
          skipped: 0,
          entries: [],
          message: `Failed to resolve meeting conflict: ${error.message}`
        };
      }
    }
  },
  {
    name: 'get_meeting_conflicts',
    description: 'List overlapping Outlook meetings for a date and any resolution already chosen, so a past choice can be reviewed or changed if plans change',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        skipCache: { type: 'boolean', description: 'Bypass the event cache (default false)' }
      },
      required: ['date']
    },
    handler: async (args) => {
      const date = args.date;
      try {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
          throw new Error('date is required in YYYY-MM-DD format');
        }
        const calendarConfig = readCalendarConfig();
        const { events } = await fetchEvents({ startDate: date, endDate: date, skipCache: Boolean(args.skipCache) });
        // Clustered on each event's original time, not any stored override,
        // so a resolved conflict is still shown as the same group if the
        // user wants to revisit the choice.
        const candidates = buildCandidates(events, calendarConfig).filter(event => !event.isAllDay);
        const clusters = computeOverlapClusters(candidates);
        const choices = readConflictChoices(date);

        const conflicts = clusters.map(cluster => ({
          date,
          events: cluster.map(event => {
            const choice = choices.get(event.id);
            return {
              id: event.id,
              subject: event.subject,
              startTime: event.startTime,
              endTime: event.endTime,
              resolution: choice ? {
                attended: choice.attended === 1,
                startTimeOverride: choice.startOverride,
                endTimeOverride: choice.endOverride
              } : null
            };
          })
        }));

        return { success: true, date, conflicts };
      } catch (error) {
        return { success: false, date, conflicts: [], message: `Failed to load meeting conflicts: ${error.message}` };
      }
    }
  },
  {
    name: 'sync_calendar_month',
    description: 'Create time entries from Outlook meetings for a whole month; safe to run repeatedly',
    parameters: {
      type: 'object',
      properties: {
        month: { type: 'string', pattern: '^\\d{4}-\\d{2}$', description: 'Month to sync (YYYY-MM)' },
        skipCache: { type: 'boolean', description: 'Bypass the event cache (default true)' }
      },
      required: ['month']
    },
    handler: async (args) => {
      try {
        const month = args.month || new Date().toLocaleDateString('en-CA').slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(month)) {
          throw new Error('month is required in YYYY-MM format');
        }

        const calendarConfig = readCalendarConfig();
        if (calendarConfig.enabled === false) {
          return {
            success: true, created: 0, skipped: 0, entries: [], days: 0,
            unmapped: 0, unmappedMeetings: [], message: 'Calendar sync is disabled'
          };
        }

        const [year, monthIndex] = month.split('-').map(Number);
        // Day 0 of the next month is the last day of this one.
        const lastDay = new Date(year, monthIndex, 0).getDate();
        const startDate = `${month}-01`;
        const endDate = `${month}-${String(lastDay).padStart(2, '0')}`;

        // One COM round trip for the whole month; the per-day logic then works
        // off this list rather than re-fetching 30 times.
        const { events } = await fetchEvents({
          startDate,
          endDate,
          skipCache: args.skipCache !== false
        });

        const byDate = new Map();
        for (const event of events) {
          if (!event.date) continue;
          if (!byDate.has(event.date)) byDate.set(event.date, []);
          byDate.get(event.date).push(event);
        }

        let created = 0;
        let skipped = 0;
        let clashed = 0;
        let adjusted = 0;
        const unmappedMeetings = [];
        const meetingConflicts = [];
        const entries = [];
        const failedDates = [];

        // Days are synced oldest first so carve-out decisions on a day are not
        // influenced by a later one, and each day is independent: one bad day
        // must not abandon the rest of the month.
        for (const date of [...byDate.keys()].sort()) {
          try {
            const result = syncDayFromEvents(date, byDate.get(date), calendarConfig);
            created += result.created || 0;
            skipped += result.skipped || 0;
            clashed += result.clashed || 0;
            adjusted += result.adjusted || 0;
            entries.push(...(result.entries || []));
            unmappedMeetings.push(
              ...(result.unmappedMeetings || []).map(meeting => ({ ...meeting, date }))
            );
            meetingConflicts.push(...(result.meetingConflicts || []));
          } catch (error) {
            failedDates.push(`${date} (${error.message})`);
          }
        }

        const parts = [];
        if (created > 0) parts.push(`Added ${created} meeting(s) across ${byDate.size} day(s)`);
        if (adjusted > 0) parts.push(`Adjusted ${adjusted} existing entr(y/ies) around meetings`);
        if (unmappedMeetings.length > 0) parts.push(`${unmappedMeetings.length} meeting(s) need a ticket`);
        if (meetingConflicts.length > 0) parts.push(`${meetingConflicts.length} overlapping meeting(s) need a choice`);
        if (failedDates.length > 0) parts.push(`Failed on ${failedDates.join(', ')}`);
        if (parts.length === 0) parts.push(`Calendar is up to date for ${month}`);

        return {
          success: true,
          month,
          days: byDate.size,
          created,
          skipped,
          clashed,
          adjusted,
          unmapped: unmappedMeetings.length,
          unmappedSubjects: [...new Set(unmappedMeetings.map(meeting => meeting.subject))],
          unmappedMeetings,
          meetingConflicts,
          entries,
          failedDates,
          message: parts.join('. ')
        };
      } catch (error) {
        return {
          success: false,
          created: 0,
          skipped: 0,
          entries: [],
          days: 0,
          unmapped: 0,
          unmappedMeetings: [],
          message: `Failed to sync calendar month: ${error.message}`,
          notConfigured: Boolean(error.notConfigured)
        };
      }
    }
  }
];
