import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { executeApi, ApiError, asList } from '@/shared/utils/api'
import { readList, asString, asRecord, asNumber, asBoolean } from '@/shared/utils/schema'
import { normalizeTimeEntries, type TimeEntry } from '@/shared/utils/state-adapters'
import { TempoVerificationError } from '@/shared/utils/errors/tempo-verification-error'
import { localDate, startOfWeek } from '@/shared/utils/dates'
import type {
  CalendarSyncResult,
  IssueData,
  LunchConflict,
  MeetingConflict,
  MeetingConflictResolutionInput,
  SubmissionRun,
  TotalsResponse,
  UnmappedMeeting
} from '@/features/entries/models/entries'

export { TempoVerificationError }

export type { TimeEntry }

export type {
  ActivityType,
  CalendarSyncResult,
  DailySummary,
  IssueData,
  LunchConflict,
  MeetingConflict,
  MeetingConflictResolutionInput,
  SubmissionRun,
  TotalsResponse,
  UnmappedMeeting
} from '@/features/entries/models/entries'

export const useEntriesStore = defineStore('entries', () => {
  const entries = computed(() => Object.values(cache.value).flat())
  const cache = ref<Record<string, TimeEntry[]>>({})
  const selectedDate = ref(localDate())
  const editingEntry = ref<TimeEntry | null>(null)
  const isSubmitting = ref(false)
  const isLoading = ref(false)
  const error = ref('')
  const recentIssues = ref<IssueData[]>([])
  const isLoadingIssues = ref(false)
  const isSyncingCalendar = ref(false)
  const calendarSyncMessage = ref('')
  const pendingUnmappedMeetings = ref<UnmappedMeeting[]>([])
  const pendingMeetingConflicts = ref<MeetingConflict[]>([])
  const pendingLunchConflict = ref<LunchConflict | null>(null)

  const replaceDate = (date: string, values: TimeEntry[]) => {
    cache.value[date] = values
  }
  const getTodayEntries = () => getEntriesByDate(localDate())
  const getEntriesByDate = (date: string) => cache.value[date] || entries.value.filter(entry => entry.date === date)
  const getTodayHours = computed(() => (getTodayEntries().reduce((sum, e) => sum + e.duration, 0) / 60).toFixed(1))
  // Only covers dates already in the cache. Callers that need a guaranteed
  // complete week must load the range first (see `loadEntriesRange`), or an
  // unvisited day counts as zero hours.
  const getWeekHours = computed(() => {
    const start = startOfWeek()
    const today = new Date()
    return (entries.value.filter(e => {
      const date = new Date(`${e.date}T00:00:00`)
      return date >= start && date <= today
    }).reduce((sum, e) => sum + e.duration, 0) / 60).toFixed(1)
  })
  // Populated from the backend rather than computed here. The frontend only
  // caches dates the user has visited, so any local calculation treats an
  // unvisited day as empty and reports it as missed.
  const missedDays = ref<string[]>([])

  const loadMissedDays = async () => {
    try {
      const result = await executeApi('get_missed_days', { lookbackDays: 7 })
      const raw = result && typeof result === 'object' ? (result as Record<string, unknown>).missedDays : null
      missedDays.value = Array.isArray(raw) ? raw.filter((d): d is string => typeof d === 'string') : []
    } catch {
      // Prefer showing nothing over showing every weekday as missed; a failed
      // lookup is not evidence that the user forgot to log time.
      missedDays.value = []
    }
  }

  // Submission runs are recorded by the backend at submit time, so the history
  // survives restarts and reflects what actually reached Tempo.
  const submissionHistory = ref<SubmissionRun[]>([])

  // SQLite's CURRENT_TIMESTAMP is UTC but carries no timezone marker, so
  // `new Date()` would read it as local time and can land on the wrong day.
  const normalizeTimestamp = (value: unknown): string => {
    const raw = String(value ?? '')
    return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw
  }

  const loadSubmissionHistory = async (limit = 10) => {
    try {
      const result = await executeApi('get_submission_history', { limit })
      const raw = result && typeof result === 'object' ? (result as Record<string, unknown>).submissions : null
      submissionHistory.value = Array.isArray(raw)
        ? raw.map(item => {
            const row = item as Record<string, unknown>
            const status = String(row.status ?? 'success')
            return {
              id: String(row.id ?? ''),
              date: String(row.date ?? ''),
              entryCount: Number(row.entryCount) || 0,
              failedCount: Number(row.failedCount) || 0,
              status: status === 'failed' || status === 'partial' ? status : 'success',
              submittedAt: normalizeTimestamp(row.submittedAt)
            } satisfies SubmissionRun
          })
        : []
    } catch {
      // History is contextual detail, not something to fail the page over.
      submissionHistory.value = []
    }
  }

  // The furthest-ahead date Tempo will accept, learned from its own responses.
  // Null means nothing has been learned yet, in which case every entry is
  // offered rather than hiding valid work behind a guess.
  const tempoCutoffDate = ref<string | null>(null)
  // The last date Tempo will accept, for display. Derived from the same
  // reading as the cutoff so the two can never disagree.
  const tempoLastAcceptedDate = ref<string | null>(null)

  const loadTempoFutureLimit = async () => {
    try {
      const result = await executeApi('tempo_get_future_limit', {})
      const row = result as Record<string, unknown> | null
      const cutoff = row?.cutoffDate
      const lastAccepted = row?.lastAcceptedDate
      tempoCutoffDate.value = typeof cutoff === 'string' && cutoff ? cutoff : null
      tempoLastAcceptedDate.value = typeof lastAccepted === 'string' && lastAccepted ? lastAccepted : null
    } catch {
      // Not knowing the window is the same as having never learned it.
      tempoCutoffDate.value = null
      tempoLastAcceptedDate.value = null
    }
  }

  const loadEntries = async (date: string) => {
    selectedDate.value = date; isLoading.value = true; error.value = ''
    try {
      const result = await executeApi('get_daily_summary', { date })
      replaceDate(date, normalizeTimeEntries(result))
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : 'Failed to load entries'
      try {
        const stored = localStorage.getItem('timelogger_entries')
        if (stored) {
          const fallback = normalizeTimeEntries(JSON.parse(stored))
          const byDate = fallback.filter(entry => entry.date === date)
          replaceDate(date, byDate)
        }
      } catch { /* malformed fallback is ignored */ }
      throw err
    } finally { isLoading.value = false }
  }

  /**
   * Load every entry between two dates into the cache.
   *
   * Each date in the span is written even when it has no rows, so a day the
   * user genuinely has nothing on is cached as empty rather than falling back
   * to the "filter whatever happens to be loaded" path in getEntriesByDate.
   */
  const loadEntriesRange = async (startDate: string, endDate: string) => {
    isLoading.value = true; error.value = ''
    try {
      const result = await executeApi('get_entries_range', { startDate, endDate })
      const loaded = normalizeTimeEntries(result)

      const byDate: Record<string, TimeEntry[]> = {}
      const cursor = new Date(`${startDate}T00:00:00`)
      const last = new Date(`${endDate}T00:00:00`)
      while (cursor <= last) {
        byDate[localDate(cursor)] = []
        cursor.setDate(cursor.getDate() + 1)
      }
      for (const entry of loaded) (byDate[entry.date] ??= []).push(entry)

      cache.value = { ...cache.value, ...byDate }
      return loaded
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : 'Failed to load entries'
      throw err
    } finally { isLoading.value = false }
  }

  const responseId = (result: unknown) => {
    const raw = result && typeof result === 'object' ? result as Record<string, unknown> : {}
    return raw.id ?? raw.entryId ?? (Array.isArray(raw.entryIds) ? raw.entryIds[0] : undefined)
  }


  const addEntry = async (entry: Omit<TimeEntry, 'id' | 'submitted' | 'submittedAt'>) => {
    isLoading.value = true; error.value = ''
    try {
      const result = await executeApi('upsert_daily_summary', {
        date: entry.date, name: entry.taskName, ticket_id: entry.ticketId,
        start_time: entry.startTime, end_time: entry.endTime, duration_mins: entry.duration
      })
      const id = responseId(result)
      if (id == null) throw new Error('Backend did not return an entry ID')
      // The backend splits a range around existing entries, so the stored
      // result can differ from what was requested. Re-read the date instead of
      // trusting the submitted values, otherwise the UI shows an overlap that
      // does not exist in the database.
      await loadEntries(entry.date)
      return getEntriesByDate(entry.date).find(item => item.id === String(id))
        ?? { ...entry, id: String(id), submitted: false }
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : String(err)
      throw err
    } finally { isLoading.value = false }
  }

  const updateEntry = async (id: string, updates: Partial<TimeEntry>) => {
    isLoading.value = true; error.value = ''
    try {
      const existing = entries.value.find(entry => entry.id === id)
      if (!existing) throw new Error('Entry not found')
      const updated = { ...existing, ...updates }
      const result = await executeApi('upsert_daily_summary', {
        id: Number(id), date: updated.date, name: updated.taskName, ticket_id: updated.ticketId,
        start_time: updated.startTime, end_time: updated.endTime, duration_mins: updated.duration
      })
      const returnedId = responseId(result)
      // An edit can also be split around neighbouring entries, so reload
      // rather than assuming the submitted range was stored verbatim.
      if (existing.date !== updated.date) await loadEntries(existing.date)
      await loadEntries(updated.date)
      return getEntriesByDate(updated.date).find(item => item.id === String(returnedId ?? id)) ?? updated
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : String(err)
      throw err
    } finally { isLoading.value = false }
  }

  const deleteEntry = async (id: string) => {
    isLoading.value = true; error.value = ''
    try {
      await executeApi('delete_daily_summary', { id: Number(id) })
      const existing = entries.value.find(entry => entry.id === id)
      if (existing) replaceDate(existing.date, getEntriesByDate(existing.date).filter(entry => entry.id !== id))
      syncEntriesPersist()
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : String(err)
      throw err
    } finally { isLoading.value = false }
  }

  const ensureLunchEntry = async (date: string) => {
    try {
      const record = asRecord(await executeApi('ensure_lunch_entry', { date }))
      if (asBoolean(record.conflict, false)) {
        // Surfaced to the daily entries screen rather than silently skipped,
        // so a day with an early/late meeting still gets a lunch entry once
        // the user picks a time that fits.
        pendingLunchConflict.value = {
          date: asString(record.date, date),
          name: asString(record.name, 'Lunch'),
          startTime: asString(record.startTime),
          endTime: asString(record.endTime),
          message: asString(record.message),
          conflictingEntries: readList(record.conflictingEntries, undefined, item => ({
            id: asNumber(item.id),
            name: asString(item.name),
            startTime: asString(item.startTime),
            endTime: asString(item.endTime)
          }))
        }
      }
      return record as { created?: boolean }
    } catch {
      // A missing lunch entry must never block startup.
      return null
    }
  }

  const resolveLunchConflict = async (startTime: string, endTime: string) => {
    const conflict = pendingLunchConflict.value
    if (!conflict) return null
    try {
      const record = asRecord(await executeApi('ensure_lunch_entry', {
        date: conflict.date,
        startTime,
        endTime,
        force: true
      }))
      if (asBoolean(record.conflict, false)) {
        // The user's new time still overlaps something; keep the prompt open
        // with the fresh conflict details instead of silently giving up.
        pendingLunchConflict.value = {
          date: asString(record.date, conflict.date),
          name: asString(record.name, conflict.name),
          startTime: asString(record.startTime, startTime),
          endTime: asString(record.endTime, endTime),
          message: asString(record.message),
          conflictingEntries: readList(record.conflictingEntries, undefined, item => ({
            id: asNumber(item.id),
            name: asString(item.name),
            startTime: asString(item.startTime),
            endTime: asString(item.endTime)
          }))
        }
        return record as { created?: boolean; conflict?: boolean }
      }
      pendingLunchConflict.value = null
      if (asBoolean(record.created, false)) await loadEntries(conflict.date)
      return record as { created?: boolean }
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : 'Failed to create lunch entry'
      return null
    }
  }

  const dismissLunchConflict = () => { pendingLunchConflict.value = null }

  const parseMeetingConflicts = (record: ReturnType<typeof asRecord>): MeetingConflict[] =>
    readList(record.meetingConflicts, undefined, item => ({
      date: asString(item.date),
      events: readList(item.events, undefined, event => ({
        id: asString(event.id),
        subject: asString(event.subject),
        startTime: asString(event.startTime),
        endTime: asString(event.endTime)
      }))
    }))

  const parseConflictList = (list: unknown): MeetingConflict[] =>
    readList(list, undefined, item => ({
      date: asString(item.date),
      events: readList(item.events, undefined, event => {
        const resolutionRecord = asRecord(event.resolution)
        return {
          id: asString(event.id),
          subject: asString(event.subject),
          startTime: asString(event.startTime),
          endTime: asString(event.endTime),
          resolution: event.resolution ? {
            attended: asBoolean(resolutionRecord.attended, false),
            startTimeOverride: resolutionRecord.startTimeOverride ? asString(resolutionRecord.startTimeOverride) : null,
            endTimeOverride: resolutionRecord.endTimeOverride ? asString(resolutionRecord.endTimeOverride) : null
          } : null
        }
      })
    }))

  const syncCalendar = async (date: string, options: { silent?: boolean } = {}) => {
    isSyncingCalendar.value = true
    calendarSyncMessage.value = ''
    try {
      const raw = await executeApi('sync_calendar_events', { date })
      const record = asRecord(raw)
      const result: CalendarSyncResult = {
        success: asBoolean(record.success, true),
        created: asNumber(record.created),
        skipped: asNumber(record.skipped),
        clashed: asNumber(record.clashed),
        clashedSubjects: asList<string>(record.clashedSubjects).map(s => asString(s)),
        adjusted: asNumber(record.adjusted),
        adjustedEntries: readList(record.adjustedEntries, undefined, item => ({
          name: asString(item.name),
          was: asString(item.was),
          now: asString(item.now)
        })),
        unmapped: asNumber(record.unmapped),
        unmappedSubjects: asList<string>(record.unmappedSubjects).map(s => asString(s)),
        unmappedMeetings: readList(record.unmappedMeetings, undefined, item => ({
          subject: asString(item.subject),
          entryIds: asList<number>(item.entryIds).map(id => asNumber(id))
        })),
        meetingConflicts: parseMeetingConflicts(record),
        message: asString(record.message),
        notConfigured: asBoolean(record.notConfigured)
      }
      if (result.created) await loadEntries(date)
      calendarSyncMessage.value = result.message
      // Surfaced regardless of how the sync was triggered: a meeting with no
      // ticket is silently dropped at Tempo upload, so an auto-sync that
      // swallowed this would lose time without ever telling anyone.
      pendingUnmappedMeetings.value = result.unmappedMeetings ?? []
      // Same reasoning for overlapping meetings: picking one automatically is
      // how the wrong meeting ends up logged, so the choice is handed back
      // to the user instead.
      pendingMeetingConflicts.value = result.meetingConflicts ?? []
      return result
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Calendar sync failed'
      calendarSyncMessage.value = message
      // Startup sync must never block the app; manual syncs surface the error.
      if (!options.silent) error.value = message
      return null
    } finally {
      isSyncingCalendar.value = false
    }
  }

  const resolveMeetingConflict = async (date: string, resolutions: MeetingConflictResolutionInput[]) => {
    try {
      const record = asRecord(await executeApi('resolve_meeting_conflict', { date, resolutions }))
      const created = asNumber(record.created)
      if (created > 0) await loadEntries(date)
      // Remove the resolved conflict; anything still unresolved (e.g. a new
      // event that appeared since) is reported fresh by the backend.
      pendingMeetingConflicts.value = pendingMeetingConflicts.value
        .filter(conflict => conflict.date !== date)
        .concat(parseMeetingConflicts(record))
      calendarSyncMessage.value = asString(record.message, calendarSyncMessage.value)
      // The review list can go stale the moment a choice changes (a new
      // override, a changed mind), so it is refreshed from the same date
      // whenever one is loaded for display.
      if (meetingConflictsForDate.value.length && meetingConflictsForDate.value[0]?.date === date) {
        await loadMeetingConflicts(date)
      }
      return record
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : 'Failed to resolve meeting conflict'
      return null
    }
  }

  const dismissMeetingConflict = (date: string) => {
    pendingMeetingConflicts.value = pendingMeetingConflicts.value.filter(conflict => conflict.date !== date)
  }

  // Every overlapping-meeting group for a date, resolved or not, so a past
  // choice can be reviewed and changed if plans change - separate from
  // pendingMeetingConflicts, which only ever holds freshly-detected ones.
  const meetingConflictsForDate = ref<MeetingConflict[]>([])
  const isLoadingMeetingConflicts = ref(false)

  const loadMeetingConflicts = async (date: string) => {
    isLoadingMeetingConflicts.value = true
    try {
      const record = asRecord(await executeApi('get_meeting_conflicts', { date }))
      meetingConflictsForDate.value = parseConflictList(record.conflicts)
      return meetingConflictsForDate.value
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : 'Failed to load meeting conflicts'
      meetingConflictsForDate.value = []
      return []
    } finally {
      isLoadingMeetingConflicts.value = false
    }
  }

  // Dates already auto-synced in this session. Without it, revisiting a day
  // that genuinely has no meetings would respawn Outlook over COM on every
  // visit, which takes seconds each time.
  const autoSyncedDates = new Set<string>()

  /**
   * Pull the calendar only when the day has nothing from it yet.
   *
   * Deliberately not run on every view: once entries exist, a re-sync would
   * fight the user's own edits. Lunch is inserted automatically at startup, so
   * a day is judged empty on the absence of calendar-sourced entries rather
   * than on the entry count.
   */
  const autoSyncCalendarIfEmpty = async (date: string) => {
    if (autoSyncedDates.has(date)) return null
    const existing = getEntriesByDate(date)
    if (existing.some(entry => entry.fromCalendar)) {
      autoSyncedDates.add(date)
      return null
    }
    autoSyncedDates.add(date)
    return syncCalendar(date, { silent: true })
  }

  const clearPendingUnmapped = () => { pendingUnmappedMeetings.value = [] }

  // Months already auto-synced in this session, for the same reason as
  // autoSyncedDates: a month with nothing new must not respawn Outlook on
  // every render.
  const autoSyncedMonths = new Set<string>()

  /**
   * Sync a whole month in one pass.
   *
   * The calendar shows a month at a time, so syncing day-by-day would spawn one
   * Outlook COM call per day. The backend fetches the month once and applies
   * the per-day logic to the grouped result.
   */
  const syncCalendarMonth = async (month: string, options: { force?: boolean } = {}) => {
    if (!options.force && autoSyncedMonths.has(month)) return null
    autoSyncedMonths.add(month)
    isSyncingCalendar.value = true
    try {
      const record = asRecord(await executeApi('sync_calendar_month', { month }))
      calendarSyncMessage.value = asString(record.message)
      if (record.success === false) return null

      const created = asNumber(record.created)
      // Entries changed underneath us, so the day currently on screen must be
      // reloaded or it will show stale rows.
      if (created > 0) await loadEntries(selectedDate.value)

      return {
        month,
        created,
        skipped: asNumber(record.skipped),
        clashed: asNumber(record.clashed),
        adjusted: asNumber(record.adjusted),
        days: asNumber(record.days),
        message: asString(record.message)
      }
    } catch (error) {
      // A failed month must not be remembered as done, or a transient Outlook
      // error would suppress syncing for the rest of the session.
      autoSyncedMonths.delete(month)
      calendarSyncMessage.value = error instanceof Error ? error.message : 'Calendar sync failed'
      return null
    } finally {
      isSyncingCalendar.value = false
    }
  }

  /**
   * Meetings on a date, or across a range, that still have no ticket.
   *
   * Read independently of syncing: a populated day never syncs again, so a
   * meeting skipped once would otherwise never be offered again and would be
   * dropped silently at upload.
   */
  const loadUnticketedMeetings = async (
    date: string,
    endDate?: string
  ): Promise<UnmappedMeeting[]> => {
    try {
      const args = endDate ? { startDate: date, endDate } : { date }
      const record = asRecord(await executeApi('sprint_get_unticketed_meetings', args))
      return readList(record.unmappedMeetings, undefined, item => ({
        subject: asString(item.subject),
        entryIds: asList<number>(item.entryIds).map(id => asNumber(id))
      }))
    } catch {
      // Never block the page on this; the manual sync path still reports.
      return []
    }
  }

  const setEditingEntry = (entry: TimeEntry | null) => { editingEntry.value = entry }
  const getTotals = async (startDate: string, endDate: string) => {
    try {
      const record = asRecord(await executeApi('get_daily_summary_totals', { startDate, endDate }))
      const totals: TotalsResponse = {
        startDate: asString(record.startDate, startDate),
        endDate: asString(record.endDate, endDate),
        totalMinutes: asNumber(record.totalMinutes),
        totalHours: asNumber(record.totalHours),
        entriesCount: asNumber(record.entriesCount),
        submittedCount: asNumber(record.submittedCount),
        unsubmittedCount: asNumber(record.unsubmittedCount)
      }
      return totals
    }
    catch (err) { error.value = err instanceof ApiError ? err.message : 'Failed to load totals'; return null }
  }
  // The tool replies with { success, issues: [...] }, not a bare array. Reading
  // it as an array leaves a plain object in the ref, and the render then dies
  // on `.forEach`, freezing the whole page.
  const normalizeIssues = (value: unknown): IssueData[] => {
    return asList<unknown>(value, 'issues')
      .map(item => (item && typeof item === 'object' ? item as Record<string, unknown> : {}))
      .filter(item => typeof item.key === 'string')
      .map(item => ({
        key: String(item.key),
        summary: item.summary != null ? String(item.summary) : '',
        status: item.status != null ? String(item.status) : undefined,
        issuetype: item.issuetype != null ? String(item.issuetype) : undefined
      }))
  }

  const loadRecentIssues = async () => {
    isLoadingIssues.value = true
    try { recentIssues.value = normalizeIssues(await executeApi('tempo_get_recent_issues', {})) }
    catch { recentIssues.value = [] }
    finally { isLoadingIssues.value = false }
  }

  const loadActivityTypes = async () => {
    const response = await executeApi('tempo_get_work_attributes', {})
    return readList(response, 'activityTypes', item => {
      const id = asString(item.id ?? item.value)
      const name = asString(item.name ?? item.value)
      return id && name ? { id, name } : null
    })
  }

  /**
   * Submits the given entries in a single call. `activityTypeMap` maps entry id
   * to a Tempo activity type UUID; entries omitted from it are classified
   * server-side. Previously this looped per entry calling a whole-day submit,
   * which re-submitted the entire day once per selected row.
   */
  const submitEntries = async (
    date: string,
    options: { entryIds?: string[]; activityTypeMap?: Record<string, string> } = {}
  ) => {
    isSubmitting.value = true; error.value = ''
    try {
      const { entryIds, activityTypeMap } = options
      // A `success: false` envelope from this tool usually means some entries
      // failed, not that the call was lost — and the detail needed to report
      // that (failedEntries, verificationFailed) is inside the payload.
      // Without recovering it, one rejected entry aborts a whole multi-date
      // run and the structured outcome is thrown away.
      let record: Record<string, unknown>
      try {
        record = asRecord(await executeApi('tempo_submit_day', { date, entryIds, activityTypeMap }))
      } catch (err) {
        const payload = err instanceof ApiError ? err.response as Record<string, unknown> | undefined : undefined
        const isSubmitResult = Boolean(payload) &&
          (payload!.verificationFailed === true || Array.isArray(payload!.failedEntries))
        if (!isSubmitResult) throw err
        record = asRecord(payload)
      }

      // Tempo could not be read, so nothing was posted and nothing changed.
      // Thrown rather than returned so callers cannot mistake it for a
      // submission that merely had nothing to do.
      if (record.verificationFailed === true) {
        const message = asString(record.message, 'Could not verify existing Tempo worklogs')
        error.value = message
        throw new TempoVerificationError(message, date)
      }

      // Only what Tempo actually accepted is marked submitted. Marking every
      // selected id made entries the backend skipped (no ticket, e.g. Lunch)
      // look submitted until the next reload, when they reappeared.
      const submittedIds = new Set(
        readList(record.worklogs, undefined, item => String(asNumber(item.id)))
      )
      const skippedEntries = readList(record.skippedEntries, undefined, item => ({
        id: String(asNumber(item.id)),
        name: asString(item.name),
        reason: asString(item.reason, 'No ticket')
      }))
      const failedEntries = readList(record.failedEntries, undefined, item => ({
        id: String(asNumber(item.id)),
        name: asString(item.name),
        reason: asString(item.reason, 'Failed'),
        // Tempo refuses dates beyond its future-logging window. Those entries
        // are valid and will post nearer the time, so callers report them
        // apart from real failures.
        futureLimited: item.futureLimited === true
      }))
      // Entries the backend found already in Tempo. They were not posted
      // again, but they are genuinely submitted, so they must be marked as
      // such or the user will be prompted to submit them forever.
      const duplicateEntries = readList(record.duplicateEntries, undefined, item => ({
        id: String(asNumber(item.id)),
        name: asString(item.name),
        detail: asString(item.detail, 'Already in Tempo')
      }))
      duplicateEntries.forEach(entry => submittedIds.add(entry.id))

      const now = new Date().toISOString()
      replaceDate(date, getEntriesByDate(date).map(entry =>
        submittedIds.has(entry.id)
          ? { ...entry, submitted: true, submittedAt: now }
          : entry
      ))
      syncEntriesPersist()

      return {
        count: asNumber(record.count),
        message: asString(record.message),
        submittedIds: [...submittedIds],
        skippedEntries,
        failedEntries,
        duplicateEntries
      }
    } catch (err) {
      // TempoVerificationError already carries a user-facing message; String()
      // would prefix it with the class name.
      if (err instanceof TempoVerificationError) throw err
      error.value = err instanceof ApiError ? err.message : String(err); throw err
    } finally { isSubmitting.value = false }
  }
  const loadEntriesFromBackend = (date = selectedDate.value) => loadEntries(date)
  const syncEntriesPersist = () => localStorage.setItem('timelogger_entries', JSON.stringify(entries.value))

  return {
    entries, selectedDate, editingEntry, isSubmitting, isLoading, error, recentIssues, isLoadingIssues,
    getTodayEntries, getEntriesByDate, getTodayHours, getWeekHours, missedDays, loadMissedDays, loadEntries,
    loadEntriesRange, submissionHistory, loadSubmissionHistory,
    tempoCutoffDate, tempoLastAcceptedDate, loadTempoFutureLimit,
    addEntry, updateEntry, deleteEntry, setEditingEntry, submitEntries, getTotals, loadRecentIssues,
    loadActivityTypes,
    ensureLunchEntry, resolveLunchConflict, dismissLunchConflict, pendingLunchConflict,
    syncCalendar, isSyncingCalendar, calendarSyncMessage,
    autoSyncCalendarIfEmpty, pendingUnmappedMeetings, clearPendingUnmapped, loadUnticketedMeetings,
    pendingMeetingConflicts, resolveMeetingConflict, dismissMeetingConflict,
    meetingConflictsForDate, isLoadingMeetingConflicts, loadMeetingConflicts,
    syncCalendarMonth,
    loadEntriesFromBackend, syncEntriesPersist
  }
})
