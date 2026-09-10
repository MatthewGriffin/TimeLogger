/**
 * Daily Summary time entry tools
 */

import { db } from '../index.js';
import { timeToMinutes, minutesToTime, splitTimeRange } from '../utils/time-ranges.js';
import { localDateKey, isWeekend, parseDateKey } from '../utils/dates.js';
import { isUkBankHoliday } from '../utils/uk-holidays.js';

/**
 * Earliest slot of the given duration, at or after windowStart, that avoids
 * every existing entry and still finishes by windowEnd. Returns null if
 * every fittingly-sized gap in the window is already taken.
 */
function findNextAvailableSlot(existingEntries, windowStart, windowEnd, durationMins) {
  const busy = existingEntries
    .filter(row => row.start_time && row.end_time)
    .map(row => ({ start: timeToMinutes(row.start_time), end: timeToMinutes(row.end_time) }))
    .sort((a, b) => a.start - b.start);

  let candidate = timeToMinutes(windowStart);
  const limit = timeToMinutes(windowEnd);
  for (const entry of busy) {
    if (candidate + durationMins <= entry.start) break;
    if (entry.end > candidate) candidate = entry.end;
  }

  if (candidate + durationMins > limit) return null;
  return { startTime: minutesToTime(candidate), endTime: minutesToTime(candidate + durationMins) };
}

export const tools = [
  {
    name: 'get_daily_summary',
    description: 'Read time entries for a date from local DB',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Date in YYYY-MM-DD format' }
      },
      required: ['date']
    },
    handler: async (args) => {
      try {
        const entries = db.prepare(`
          SELECT * FROM daily_summary 
          WHERE date = ? 
          ORDER BY start_time ASC
        `).all(args.date);
        
        const totalMins = entries.reduce((sum, e) => sum + (e.duration_mins || 0), 0);
        const submitted = entries.filter(e => e.submitted).length;
        
        return {
          success: true,
          date: args.date,
          entries,
          totalMinutes: totalMins,
          totalHours: (totalMins / 60).toFixed(2),
          entriesCount: entries.length,
          submittedCount: submitted,
          unsubmittedCount: entries.length - submitted
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to fetch daily summary: ${error.message}`
        };
      }
    }
  },
  {
    name: 'get_missed_days',
    description: 'List recent working days with no logged time, or with time that has not been submitted',
    parameters: {
      type: 'object',
      properties: {
        lookbackDays: { type: 'number', description: 'How many days back to inspect (default 7)' },
        today: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Override "today"; defaults to the local date' }
      },
      required: []
    },
    handler: async (args) => {
      try {
        const lookback = Number.isFinite(Number(args?.lookbackDays))
          ? Math.max(1, Math.min(90, Math.floor(Number(args.lookbackDays))))
          : 7;

        // Anchored on the caller's local date. Deriving "today" from a UTC
        // timestamp reports the wrong day for anyone west of UTC in the
        // evening, which would silently shift the whole window.
        const anchor = parseDateKey(args?.today) ?? new Date();

        const days = [];
        for (let offset = 1; offset <= lookback; offset++) {
          const day = new Date(anchor);
          day.setDate(anchor.getDate() - offset);
          // Weekends are not expected to have time logged against them.
          if (isWeekend(day)) continue;
          days.push(localDateKey(day));
        }
        if (days.length === 0) {
          return { success: true, missedDays: [], days: [], lookbackDays: lookback };
        }

        const placeholders = days.map(() => '?').join(',');
        const rows = db.prepare(`
          SELECT date,
                 COUNT(*) AS entryCount,
                 COALESCE(SUM(duration_mins), 0) AS totalMinutes,
                 SUM(CASE WHEN submitted = 1 THEN 1 ELSE 0 END) AS submittedCount,
                 SUM(CASE WHEN is_holiday = 1 THEN 1 ELSE 0 END) AS holidayCount
          FROM daily_summary
          WHERE date IN (${placeholders})
          GROUP BY date
        `).all(...days);

        const byDate = new Map(rows.map(row => [row.date, row]));
        const evaluated = days.map(date => {
          const row = byDate.get(date);
          const entryCount = row?.entryCount ?? 0;
          const totalMinutes = row?.totalMinutes ?? 0;
          const submittedCount = row?.submittedCount ?? 0;
          // A day counts as a holiday either because leave was synced from the
          // calendar, or because it is a public holiday. The latter matters on
          // its own: a bank holiday usually has no calendar entry at all, so
          // without this it looks identical to a day the user forgot.
          const bankHoliday = isUkBankHoliday(date);
          const isHoliday = (row?.holidayCount ?? 0) > 0 || bankHoliday;

          let status;
          if (isHoliday) status = 'holiday';
          else if (entryCount === 0 || totalMinutes === 0) status = 'no_time_logged';
          else if (submittedCount === 0) status = 'not_submitted';
          else if (submittedCount < entryCount) status = 'partially_submitted';
          else status = 'complete';

          return { date, entryCount, totalMinutes, submittedCount, isHoliday, bankHoliday, status };
        }).sort((a, b) => a.date.localeCompare(b.date));

        // Leave and bank holidays are not days the user failed to fill in, and
        // a fully submitted day is done, so neither counts as missed.
        const missed = evaluated.filter(day => day.status !== 'complete' && day.status !== 'holiday');

        return {
          success: true,
          lookbackDays: lookback,
          days: evaluated,
          missedDays: missed.map(day => day.date),
          missedCount: missed.length,
          missed
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to determine missed days: ${error.message}`
        };
      }
    }
  },
  {
    name: 'get_entries_range',
    description: 'Read all time entries between two dates (inclusive)',
    parameters: {
      type: 'object',
      properties: {
        startDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Start date in YYYY-MM-DD' },
        endDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'End date in YYYY-MM-DD' },
        unsubmittedOnly: { type: 'boolean', description: 'Return only entries not yet submitted' }
      },
      required: ['startDate', 'endDate']
    },
    handler: async (args) => {
      try {
        if (!parseDateKey(args?.startDate) || !parseDateKey(args?.endDate)) {
          return { success: false, message: 'startDate and endDate must be YYYY-MM-DD dates' };
        }

        // Swap rather than reject: a user dragging a range backwards means the
        // same span, and failing here would just look like the filter is broken.
        let [start, end] = [args.startDate, args.endDate];
        if (start > end) [start, end] = [end, start];

        const entries = db.prepare(`
          SELECT * FROM daily_summary
          WHERE date >= ? AND date <= ?
          ${args?.unsubmittedOnly ? 'AND submitted = 0' : ''}
          ORDER BY date ASC, start_time ASC
        `).all(start, end);

        const totalMins = entries.reduce((sum, e) => sum + (e.duration_mins || 0), 0);
        const submitted = entries.filter(e => e.submitted).length;

        return {
          success: true,
          startDate: start,
          endDate: end,
          entries,
          totalMinutes: totalMins,
          totalHours: (totalMins / 60).toFixed(2),
          entriesCount: entries.length,
          submittedCount: submitted,
          unsubmittedCount: entries.length - submitted
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to fetch entries for range: ${error.message}`
        };
      }
    }
  },
  {
    name: 'get_submission_history',
    description: 'Read recent Tempo submission runs from local DB',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum runs to return (default 10, max 100)' }
      }
    },
    handler: async (args = {}) => {
      try {
        const requested = Number(args.limit);
        const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), 100) : 10;

        const rows = db.prepare(`
          SELECT id, date, count, status, failed_count, submitted_at
          FROM submission_history
          ORDER BY submitted_at DESC, id DESC
          LIMIT ?
        `).all(limit);

        return {
          success: true,
          submissions: rows.map(row => ({
            id: String(row.id),
            date: row.date,
            entryCount: row.count || 0,
            failedCount: row.failed_count || 0,
            // Rows written before the status column existed default to success.
            status: row.status || 'success',
            submittedAt: row.submitted_at
          }))
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to fetch submission history: ${error.message}`
        };
      }
    }
  },
  {
    name: 'upsert_daily_summary',
    description: 'Insert or update a time entry; auto-splits overlapping time ranges',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Entry ID (for update)' },
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        name: { type: 'string', description: 'Task name' },
        ticket_id: { type: 'string', description: 'Jira ticket' },
        start_time: { type: 'string', description: 'HH:MM format' },
        end_time: { type: 'string', description: 'HH:MM format' },
        duration_mins: { type: 'number', description: 'Alternative to start/end times' }
      },
      required: ['date', 'name']
    },
    handler: async (args) => {
      try {
        // If it's an update (has ID)
        if (args.id) {
          const current = db.prepare('SELECT * FROM daily_summary WHERE id = ?').get(args.id);
          if (!current) {
            return { success: false, message: `No entry found with ID ${args.id}` };
          }

          const startTime = args.start_time ?? current.start_time;
          const endTime = args.end_time ?? current.end_time;
          const date = args.date ?? current.date;
          const extraIds = [];

          // Editing a submitted entry means the plan changed after it was
          // logged to Tempo, so the flag must not survive a real change —
          // otherwise the entry can never be picked up again on the next
          // submit. An edit that leaves every field the same (e.g. a no-op
          // save) does not need to be resubmitted.
          const ticketId = args.ticket_id || null;
          const currentTicketId = current.ticket_id || null;
          const changed = current.name !== args.name ||
            currentTicketId !== ticketId ||
            current.start_time !== startTime ||
            current.end_time !== endTime;
          const resetSubmitted = changed && current.submitted === 1;

          // Apply the same wrap-around rules as inserts so an edit cannot
          // create an overlap. The entry being edited is excluded from the
          // comparison set, otherwise it would always collide with itself.
          if (startTime && endTime) {
            const existing = db.prepare(
              'SELECT * FROM daily_summary WHERE date = ? AND id != ?'
            ).all(date, args.id);
            const segments = splitTimeRange(startTime, endTime, existing);

            if (segments.length === 0) {
              return {
                success: false,
                message: `Time range ${startTime}-${endTime} overlaps completely with existing entries`
              };
            }

            const [first, ...rest] = segments;
            db.prepare(`
              UPDATE daily_summary
              SET date = ?, name = ?, ticket_id = ?, start_time = ?, end_time = ?, duration_mins = ?,
                  submitted = CASE WHEN ? THEN 0 ELSE submitted END, updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `).run(date, args.name, args.ticket_id || null, first.start, first.end, first.durationMins, resetSubmitted ? 1 : 0, args.id);

            for (const segment of rest) {
              const inserted = db.prepare(`
                INSERT INTO daily_summary (date, name, ticket_id, start_time, end_time, duration_mins)
                VALUES (?, ?, ?, ?, ?, ?)
              `).run(date, args.name, args.ticket_id || null, segment.start, segment.end, segment.durationMins);
              extraIds.push(inserted.lastInsertRowid);
            }

            return {
              success: true,
              message: `Entry updated (${segments.length} segment(s))` +
                (resetSubmitted ? '. Marked as not submitted so the change can be resubmitted to Tempo.' : ''),
              entryId: args.id,
              entryIds: [args.id, ...extraIds],
              resubmitRequired: resetSubmitted
            };
          }

          db.prepare(`
            UPDATE daily_summary 
            SET date = ?, name = ?, ticket_id = ?, start_time = ?, end_time = ?, duration_mins = ?,
                submitted = CASE WHEN ? THEN 0 ELSE submitted END, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(date, args.name, args.ticket_id || null, startTime, endTime, args.duration_mins, resetSubmitted ? 1 : 0, args.id);

          return {
            success: true,
            message: 'Entry updated' +
              (resetSubmitted ? '. Marked as not submitted so the change can be resubmitted to Tempo.' : ''),
            entryId: args.id,
            entryIds: [args.id],
            resubmitRequired: resetSubmitted
          };
        }
        
        // Calculate duration if start/end times provided
        let durationMins = args.duration_mins;
        if (!durationMins && args.start_time && args.end_time) {
          durationMins = timeToMinutes(args.end_time) - timeToMinutes(args.start_time);
        }

        // Treat an identical request as an idempotent upsert rather than
        // reporting a full overlap when a client retries the request.
        if (args.start_time && args.end_time) {
          const existingEntry = db.prepare(`
            SELECT id FROM daily_summary
            WHERE date = ? AND name = ? AND ticket_id IS ? AND start_time = ? AND end_time = ?
            LIMIT 1
          `).get(
            args.date,
            args.name,
            args.ticket_id || null,
            args.start_time,
            args.end_time
          );
          if (existingEntry) {
            return {
              success: true,
              message: 'Entry already exists',
              entryId: existingEntry.id,
              entryIds: [existingEntry.id]
            };
          }
        }
        
        // Check for overlaps and split if needed
        let insertedCount = 0;
        const insertedIds = [];
        
        if (args.start_time && args.end_time) {
          const existing = db.prepare(`
            SELECT * FROM daily_summary 
            WHERE date = ?
          `).all(args.date);
          
          const segments = splitTimeRange(args.start_time, args.end_time, existing);
          
          if (segments.length === 0) {
            return {
              success: false,
              message: `Time range ${args.start_time}-${args.end_time} overlaps completely with existing entries`
            };
          }
          
          for (const segment of segments) {
            const result = db.prepare(`
              INSERT INTO daily_summary (date, name, ticket_id, start_time, end_time, duration_mins)
              VALUES (?, ?, ?, ?, ?, ?)
            `).run(args.date, args.name, args.ticket_id || null, segment.start, segment.end, segment.durationMins);
            insertedCount++;
            insertedIds.push(result.lastInsertRowid);
          }
        } else {
          // Just duration, no time range
          const result = db.prepare(`
            INSERT INTO daily_summary (date, name, ticket_id, duration_mins)
            VALUES (?, ?, ?, ?)
          `).run(args.date, args.name, args.ticket_id || null, durationMins);
          insertedCount = 1;
          insertedIds.push(result.lastInsertRowid);
        }
        
        return {
          success: true,
          message: `Entry created (${insertedCount} segment(s))`,
          entryId: insertedIds[0],
          entryIds: insertedIds
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to upsert entry: ${error.message}`
        };
      }
    }
  },
  {
    name: 'ensure_lunch_entry',
    description: 'Ensure the recurring lunch break exists for a date; idempotent. Reports a conflict instead of overwriting an entry already in the lunch window, and accepts an override start/end time to resolve it.',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        startTime: { type: 'string', description: 'Override lunch start time (HH:MM), used to resolve a reported conflict' },
        endTime: { type: 'string', description: 'Override lunch end time (HH:MM), used to resolve a reported conflict' },
        force: { type: 'boolean', description: 'Create the entry even if the window overlaps an existing entry' }
      },
      required: ['date']
    },
    handler: async (args) => {
      try {
        const settings = db.prepare("SELECT value FROM settings WHERE key = 'app_config'").get();
        let lunch = {};
        if (settings) {
          try { lunch = (JSON.parse(settings.value) || {}).lunch || {}; } catch { lunch = {}; }
        }

        if (lunch.enabled === false) {
          return { success: true, created: false, message: 'Lunch auto-entry is disabled' };
        }

        const name = lunch.name || 'Lunch';
        // An explicit startTime/endTime is how the caller resolves a
        // previously reported conflict with a user-chosen time, so it
        // always takes priority over the configured default.
        const configuredStart = lunch.startTime || '12:00';
        const configuredEnd = lunch.endTime || '13:00';
        const startTime = args.startTime || configuredStart;
        const endTime = args.endTime || configuredEnd;
        const durationMins = timeToMinutes(configuredEnd) - timeToMinutes(configuredStart);

        // No lunch break is taken on a day off. Checked before the window test
        // because startup adds lunch before the calendar has been synced.
        const holiday = db.prepare('SELECT id FROM daily_summary WHERE date = ? AND is_holiday = 1 LIMIT 1').get(args.date);
        if (holiday) {
          return { success: true, created: false, message: 'Day is booked as time off' };
        }

        // A lunch entry already logged for the day (its own default slot, or
        // a previously chosen time) means this call is a no-op repeat of an
        // earlier sync, not a new conflict to report.
        const alreadyExists = db.prepare(
          'SELECT id FROM daily_summary WHERE date = ? AND name = ? LIMIT 1'
        ).get(args.date, name);
        if (alreadyExists && !args.force) {
          return { success: true, created: false, message: 'Lunch entry already exists for this day' };
        }

        // Any entry already covering the lunch window means the user has
        // deliberately logged that time, so never overwrite it without
        // confirmation.
        const lunchStart = timeToMinutes(startTime);
        const lunchEnd = timeToMinutes(endTime);
        const existing = db.prepare('SELECT * FROM daily_summary WHERE date = ?').all(args.date);

        const conflicts = existing.filter(row => {
          if (!row.start_time || !row.end_time) return false;
          return timeToMinutes(row.start_time) < lunchEnd && timeToMinutes(row.end_time) > lunchStart;
        });

        if (conflicts.length > 0 && !args.force) {
          // Lunch can move anywhere in a window either side of its usual
          // slot, so the next free gap is suggested instead of just handing
          // back the same clashing default time for the user to fix by hand.
          const windowStart = configuredStart;
          const windowEnd = minutesToTime(timeToMinutes(configuredEnd) + durationMins);
          const suggestion = findNextAvailableSlot(existing, windowStart, windowEnd, durationMins);

          return {
            success: true,
            created: false,
            conflict: true,
            message: `Lunch window ${startTime}-${endTime} overlaps an existing entry`,
            date: args.date,
            name,
            startTime: suggestion?.startTime || startTime,
            endTime: suggestion?.endTime || endTime,
            conflictingEntries: conflicts.map(row => ({
              id: row.id,
              name: row.name,
              startTime: row.start_time,
              endTime: row.end_time
            }))
          };
        }

        const result = db.prepare(`
          INSERT INTO daily_summary (date, name, ticket_id, start_time, end_time, duration_mins)
          VALUES (?, ?, NULL, ?, ?, ?)
        `).run(args.date, name, startTime, endTime, lunchEnd - lunchStart);

        return {
          success: true,
          created: true,
          message: 'Lunch entry created',
          entryId: result.lastInsertRowid
        };
      } catch (error) {
        return { success: false, message: `Failed to ensure lunch entry: ${error.message}` };
      }
    }
  },
  {
    name: 'delete_daily_summary',
    description: 'Delete a time entry by ID',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Entry ID' }
      },
      required: ['id']
    },
    handler: async (args) => {
      try {
        const result = db.prepare('DELETE FROM daily_summary WHERE id = ?').run(args.id);
        
        if (result.changes === 0) {
          return {
            success: false,
            message: `No entry found with ID ${args.id}`
          };
        }
        
        return {
          success: true,
          message: 'Entry deleted'
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to delete entry: ${error.message}`
        };
      }
    }
  },
  {
    name: 'mark_entries_for_resubmit',
    description: 'Clear the submitted flag on entries the app believes were sent to Tempo but no longer exist there (e.g. deleted directly in Tempo), so they show up as unsubmitted and can be sent again',
    parameters: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          description: 'Entry IDs to mark as not submitted',
          items: { type: 'number' }
        }
      },
      required: ['ids']
    },
    handler: async (args) => {
      try {
        const ids = Array.isArray(args.ids) ? args.ids.filter(id => Number.isSafeInteger(Number(id))) : [];
        if (ids.length === 0) {
          return { success: false, message: 'No entry IDs provided', updated: 0 };
        }

        const update = db.prepare(`
          UPDATE daily_summary SET submitted = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `);
        let updated = 0;
        for (const id of ids) {
          updated += update.run(Number(id)).changes;
        }

        return {
          success: true,
          updated,
          message: `${updated} entr${updated === 1 ? 'y' : 'ies'} marked as not submitted and ready to resubmit`
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to mark entries for resubmit: ${error.message}`,
          updated: 0
        };
      }
    }
  },
  {
    name: 'get_daily_summary_totals',
    description: 'Get statistics and totals for daily summaries across a date range',
    parameters: {
      type: 'object',
      properties: {
        startDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Start date in YYYY-MM-DD' },
        endDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'End date in YYYY-MM-DD' }
      },
      required: ['startDate', 'endDate']
    },
    handler: async (args) => {
      try {
        // Get all entries for date range
        const entries = db.prepare(`
          SELECT * FROM daily_summary 
          WHERE date >= ? AND date <= ?
          ORDER BY date ASC, start_time ASC
        `).all(args.startDate, args.endDate);
        
        if (entries.length === 0) {
          return {
            success: true,
            message: 'No entries found',
            startDate: args.startDate,
            endDate: args.endDate,
            totalHours: 0,
            entriesCount: 0,
            submittedCount: 0,
            weekTotals: {}
          };
        }
        
        // Calculate totals
        let totalMins = 0;
        let submittedCount = 0;
        const dailyTotals = {};
        const weekTotals = {};
        
        for (const entry of entries) {
          const mins = entry.duration_mins || 0;
          totalMins += mins;
          if (entry.submitted) submittedCount++;
          
          // Daily totals
          if (!dailyTotals[entry.date]) {
            dailyTotals[entry.date] = 0;
          }
          dailyTotals[entry.date] += mins;
          
          // Week totals
          const date = new Date(entry.date + 'T00:00:00Z');
          const dayOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getUTCDay()];
          if (!weekTotals[dayOfWeek]) {
            weekTotals[dayOfWeek] = 0;
          }
          weekTotals[dayOfWeek] += mins;
        }
        
        // Convert to hours
        const totalHours = (totalMins / 60).toFixed(2);
        
        // Convert daily totals to hours
        const dailyHours = {};
        for (const [date, mins] of Object.entries(dailyTotals)) {
          dailyHours[date] = (mins / 60).toFixed(2);
        }
        
        // Convert week totals to hours
        const weekHours = {};
        for (const [day, mins] of Object.entries(weekTotals)) {
          weekHours[day] = (mins / 60).toFixed(2);
        }
        
        return {
          success: true,
          startDate: args.startDate,
          endDate: args.endDate,
          totalHours: parseFloat(totalHours),
          totalMinutes: totalMins,
          entriesCount: entries.length,
          submittedCount,
          unsubmittedCount: entries.length - submittedCount,
          dailyHours,
          weekTotals: weekHours
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to fetch totals: ${error.message}`
        };
      }
    }
  }
];
