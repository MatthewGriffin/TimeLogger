<template>
  <div class="submit-page">
    <!-- Page Header -->
    <div class="page-header">
      <h1>Submit Time</h1>
      <div class="header-actions">
        <button
          v-for="range in dateRanges"
          :key="range"
          :class="['btn-range', { active: selectedRange === range }]"
          :aria-pressed="selectedRange === range"
          @click="selectRange(range)"
        >
          {{ range }}
        </button>
      </div>
    </div>

    <!-- Date range -->
    <div class="range-bar">
      <div v-if="selectedRange === 'Custom'" class="custom-range">
        <label class="range-field">
          <span>From</span>
          <input v-model="customStart" type="date" :max="customEnd || undefined" class="date-input" />
        </label>
        <label class="range-field">
          <span>To</span>
          <input v-model="customEnd" type="date" :min="customStart || undefined" class="date-input" />
        </label>
      </div>
      <p class="range-summary">
        <span v-if="entriesStore.isLoading">Loading…</span>
        <span v-else-if="rangeError" class="range-error">{{ rangeError }}</span>
        <span v-else>Showing {{ rangeLabel }}</span>
      </p>
    </div>

    <!-- Content -->
    <div class="submit-content">
      <div class="submit-left">
        <!-- Filters and Controls -->
        <div class="controls-section">
          <div class="control-group">
            <label>Override all</label>
            <select v-model="bulkActivityType" class="select-control" @change="applyBulkType">
              <option value="">Per-entry (auto)</option>
              <option v-for="type in activityTypes" :key="type.id" :value="type.id">
                {{ type.name }}
              </option>
            </select>
          </div>

          <div class="control-group">
            <button class="btn-submit-all" @click="submitSelected" :disabled="selectedEntries.length === 0 || isSubmitting">
              {{ isSubmitting ? 'Submitting...' : `Submit Selected (${selectedEntries.length})` }}
            </button>
          </div>
        </div>

        <!-- Entries Table -->
        <div class="entries-section">
          <div class="section-header">
            <h2>Unsubmitted Entries</h2>
            <span class="entry-count">{{ unsubmittedEntries.length }} entries</span>
          </div>

          <div v-if="unsubmittedEntries.length > 0" class="entries-table">
            <div class="table-header">
              <div class="col-checkbox">
                <input
                  type="checkbox"
                  v-model="selectAll"
                  @change="toggleSelectAll"
                />
              </div>
              <div class="col-date">Date</div>
              <div class="col-task">Task</div>
              <div class="col-ticket">Ticket</div>
              <div class="col-activity">Activity Type</div>
              <div class="col-hours">Hours</div>
            </div>

            <div class="table-body">
              <div
                v-for="entry in unsubmittedEntries"
                :key="entry.id"
                class="table-row"
                :class="{ selected: selectedEntries.includes(entry.id) }"
              >
                <div class="col-checkbox">
                  <input
                    type="checkbox"
                    :checked="selectedEntries.includes(entry.id)"
                    @change="toggleEntry(entry.id)"
                  />
                </div>
                <div class="col-date">{{ formatDate(entry.date) }}</div>
                <div class="col-task">{{ entry.taskName }}</div>
                <div class="col-ticket">{{ entry.ticketId || '-' }}</div>
                <div class="col-activity">
                  <select
                    class="select-activity"
                    :value="activityFor(entry.id)"
                    @change="setActivity(entry.id, ($event.target as HTMLSelectElement).value)"
                  >
                    <option value="">Auto</option>
                    <option v-for="type in activityTypes" :key="type.id" :value="type.id">
                      {{ type.name }}
                    </option>
                  </select>
                  <span
                    v-if="suggestionSource(entry.id)"
                    class="source-badge"
                    :class="`source-${suggestionSource(entry.id)}`"
                    :title="`Determined by: ${suggestionSource(entry.id)}`"
                  >{{ suggestionSource(entry.id) }}</span>
                </div>
                <div class="col-hours">{{ formatDuration(entry.duration) }}</div>
              </div>
            </div>
          </div>

          <div v-else class="empty-state">
            <div class="empty-icon">✅</div>
            <p>All entries have been submitted!</p>
          </div>

          <!-- Entries Tempo will not accept yet. Listed rather than offered
               for submission, since selecting them can only ever fail. -->
          <div v-if="futureBlockedEntries.length > 0" class="blocked-section deferred-section">
            <div class="blocked-header">
              <span class="blocked-icon">📅</span>
              <span>
                {{ futureBlockedEntries.length }}
                entr{{ futureBlockedEntries.length === 1 ? 'y' : 'ies' }}
                dated too far ahead for Tempo
              </span>
            </div>
            <div class="blocked-list">
              <div v-for="entry in futureBlockedEntries" :key="entry.id" class="blocked-row">
                <span class="blocked-date">{{ formatDate(entry.date) }}</span>
                <span class="blocked-task">{{ entry.taskName }}</span>
                <span class="blocked-hours">{{ formatDuration(entry.duration) }}</span>
              </div>
            </div>
            <p class="blocked-hint">
              {{ tempoWindowHint }}
              These will become submittable nearer their date.
            </p>
          </div>

          <!-- Entries that cannot reach Tempo. Shown rather than dropped
               silently, which is what previously made Lunch look submittable. -->
          <div v-if="blockedEntries.length > 0" class="blocked-section">
            <div class="blocked-header">
              <span class="blocked-icon">🚫</span>
              <span>
                {{ blockedEntries.length }} entr{{ blockedEntries.length === 1 ? 'y' : 'ies' }}
                cannot be submitted — no ticket
              </span>
            </div>
            <div class="blocked-list">
              <div v-for="entry in blockedEntries" :key="entry.id" class="blocked-row">
                <span class="blocked-date">{{ formatDate(entry.date) }}</span>
                <span class="blocked-task">{{ entry.taskName }}</span>
                <span class="blocked-hours">{{ formatDuration(entry.duration) }}</span>
              </div>
            </div>
            <p class="blocked-hint">
              Breaks such as Lunch belong here. Assign a ticket on Daily Entries if any of these
              should be logged to Tempo.
            </p>
          </div>
        </div>
      </div>

      <!-- Submission History -->
      <div class="submit-right">
        <div class="history-section">
          <h2>Submission History</h2>
          <div class="history-list">
            <div
              v-for="submission in submissionHistory"
              :key="submission.id"
              :class="['history-item', `status-${submission.status}`]"
            >
              <div class="history-icon">{{ submission.status === 'success' ? '✓' : submission.status === 'partial' ? '!' : '✕' }}</div>
              <div class="history-content">
                <div class="history-date">{{ formatDate(submission.date) }}</div>
                <div class="history-count">
                  {{ submission.entryCount }} {{ submission.entryCount === 1 ? 'entry' : 'entries' }}
                  <span v-if="submission.failedCount > 0"> · {{ submission.failedCount }} failed</span>
                </div>
                <div class="history-time">{{ formatSubmittedAt(submission.submittedAt) }}</div>
              </div>
              <div class="history-status">{{ submission.status }}</div>
            </div>
          </div>
          <div v-if="submissionHistory.length === 0" class="empty-state small">
            <p>No submissions yet</p>
          </div>
        </div>

        <!-- Summary -->
        <div class="summary-section">
          <h2>Summary</h2>
          <div class="summary-stats">
            <div class="stat">
              <span class="stat-label">Total Hours</span>
              <span class="stat-value">{{ totalHours }}</span>
            </div>
            <div class="stat">
              <span class="stat-label">Selected Hours</span>
              <span class="stat-value">{{ selectedHours }}</span>
            </div>
            <div class="stat">
              <span class="stat-label">Pending</span>
              <span class="stat-value">{{ pendingCount }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- AI Summary Modal -->
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useEntriesStore, TempoVerificationError, type ActivityType } from '../stores/entries'
import { useUiStore } from '../stores/ui'
import { localDate, startOfWeek } from '../utils/dates'

const entriesStore = useEntriesStore()
const uiStore = useUiStore()

const dateRanges = ['This Week', 'Last Week', 'This Month', 'Custom'] as const
type DateRange = typeof dateRanges[number]

const selectedRange = ref<DateRange>('This Week')
const customStart = ref('')
const customEnd = ref('')
const rangeError = ref('')
const selectedEntries = ref<string[]>([])
const selectAll = ref(false)
const isSubmitting = ref(false)

// Per-entry activity types. `activityOverrides` holds the user's explicit
// choice; an entry left on "Auto" (no override) is classified by AI
// server-side at submit time, so no client-side preview step is needed.
const activityTypes = ref<ActivityType[]>([])
const activityOverrides = ref<Record<string, string>>({})
const bulkActivityType = ref('')

const activityFor = (id: string) => activityOverrides.value[id] ?? ''

const setActivity = (id: string, value: string) => {
  if (value) activityOverrides.value[id] = value
  else delete activityOverrides.value[id]
}

const suggestionSource = (id: string) => (activityOverrides.value[id] ? 'manual' : '')

const applyBulkType = () => {
  if (!bulkActivityType.value) {
    activityOverrides.value = {}
    return
  }
  for (const id of selectedEntries.value) activityOverrides.value[id] = bulkActivityType.value
}

const loadTypes = async () => {
  try { activityTypes.value = await entriesStore.loadActivityTypes() }
  catch { activityTypes.value = [] }
}

onMounted(loadTypes)
onMounted(() => entriesStore.loadSubmissionHistory())
onMounted(() => entriesStore.loadTempoFutureLimit())

// Submission history comes from the backend, which records every run at
// submit time.
const submissionHistory = computed(() => entriesStore.submissionHistory)

/**
 * Resolve a named range to concrete start/end dates.
 *
 * Weeks run Monday to Sunday: the working week is what is being submitted, so
 * a Sunday-start week would split the week the user is actually filling in.
 */
const resolveRange = (range: DateRange): { start: string; end: string } | null => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (range === 'This Week') {
    const start = startOfWeek(today)
    const end = new Date(start)
    end.setDate(start.getDate() + 6)
    return { start: localDate(start), end: localDate(end) }
  }

  if (range === 'Last Week') {
    const start = startOfWeek(today)
    start.setDate(start.getDate() - 7)
    const end = new Date(start)
    end.setDate(start.getDate() + 6)
    return { start: localDate(start), end: localDate(end) }
  }

  if (range === 'This Month') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1)
    // Day 0 of the next month is the last day of this one, which keeps the
    // month length correct without hardcoding 28/30/31.
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    return { start: localDate(start), end: localDate(end) }
  }

  if (!customStart.value || !customEnd.value) return null
  return customStart.value <= customEnd.value
    ? { start: customStart.value, end: customEnd.value }
    : { start: customEnd.value, end: customStart.value }
}

const activeRange = computed(() => resolveRange(selectedRange.value))

const rangeLabel = computed(() => {
  const resolved = activeRange.value
  if (!resolved) return 'Choose a start and end date'
  return resolved.start === resolved.end
    ? formatDate(resolved.start)
    : `${formatDate(resolved.start)} – ${formatDate(resolved.end)}`
})

const applyRange = async () => {
  const resolved = activeRange.value
  if (!resolved) {
    rangeError.value = ''
    return
  }
  rangeError.value = ''
  try {
    await entriesStore.loadEntriesRange(resolved.start, resolved.end)
    // Anything no longer in view must not stay selected, or a hidden entry
    // would be submitted by a button the user reads as applying to the list.
    const visible = new Set(unsubmittedEntries.value.map(e => e.id))
    selectedEntries.value = selectedEntries.value.filter(id => visible.has(id))
    selectAll.value = false
  } catch {
    rangeError.value = 'Could not load entries for this range.'
  }
}

const selectRange = (range: DateRange) => {
  selectedRange.value = range
  if (range === 'Custom' && !customStart.value && !customEnd.value) {
    // Seed the pickers with the week already on screen so the fields open on a
    // sensible span rather than empty.
    const week = resolveRange('This Week')
    if (week) { customStart.value = week.start; customEnd.value = week.end }
  }
  applyRange()
}

watch([customStart, customEnd], () => {
  if (selectedRange.value === 'Custom') applyRange()
})

onMounted(applyRange)

// Only entries with a ticket can reach Tempo, so the selectable list is
// limited to those. Everything else is shown separately rather than hidden,
// which would be the same silent drop in a different place.
const hasTicket = (entry: { ticketId?: string }) => Boolean(entry.ticketId && entry.ticketId.trim())

/**
 * Entries the selected range actually covers.
 *
 * The store caches every date that has ever been loaded and exposes them as
 * one flat list, so filtering only on `submitted` would show entries from
 * previously viewed ranges and make the range buttons look inert.
 */
const entriesInRange = computed(() => {
  const resolved = activeRange.value
  if (!resolved) return []
  return entriesStore.entries.filter(e => e.date >= resolved.start && e.date <= resolved.end)
})

/**
 * Entries dated beyond the window Tempo will accept.
 *
 * Tempo rejects these outright, so offering them as submittable only invites a
 * guaranteed failure. They are listed separately as a "not yet" instead, and
 * the window itself is learned from Tempo rather than assumed.
 */
const futureBlockedEntries = computed(() => {
  const cutoff = entriesStore.tempoCutoffDate
  if (!cutoff) return []
  return entriesInRange.value.filter(e => !e.submitted && hasTicket(e) && e.date >= cutoff)
})

/**
 * How far ahead Tempo currently accepts work, phrased for the hint text.
 *
 * Falls back to a general statement rather than rendering an invalid date if
 * the boundary is somehow unknown while the section is visible.
 */
const tempoWindowHint = computed(() => {
  const lastAccepted = entriesStore.tempoLastAcceptedDate
  return lastAccepted
    ? `Tempo only accepts worklogs up to ${formatDate(lastAccepted)}.`
    : 'Tempo does not accept worklogs dated this far ahead.'
})

const unsubmittedEntries = computed(() => {
  const cutoff = entriesStore.tempoCutoffDate
  return entriesInRange.value.filter(e =>
    !e.submitted && hasTicket(e) && (!cutoff || e.date < cutoff)
  )
})

const blockedEntries = computed(() =>
  entriesInRange.value.filter(e => !e.submitted && !hasTicket(e))
)

const totalHours = computed(() => {
  const minutes = unsubmittedEntries.value.reduce((sum, e) => sum + (Number(e.duration) || 0), 0)
  return (minutes / 60).toFixed(2)
})

const selectedHours = computed(() => {
  const minutes = entriesInRange.value
    .filter(e => selectedEntries.value.includes(e.id))
    .reduce((sum, e) => sum + (Number(e.duration) || 0), 0)
  return (minutes / 60).toFixed(2)
})

const pendingCount = computed(() => {
  return unsubmittedEntries.value.length
})

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    weekday: 'short'
  })
}

/** When a submission run happened, shown as a short local date and time. */
const formatSubmittedAt = (value: string) => {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

const formatDuration = (minutes: number) => {
  const total = Number(minutes) || 0
  const hours = Math.floor(total / 60)
  const mins = total % 60
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

const toggleEntry = (id: string) => {
  const idx = selectedEntries.value.indexOf(id)
  if (idx > -1) {
    selectedEntries.value.splice(idx, 1)
  } else {
    selectedEntries.value.push(id)
  }
  updateSelectAll()
}

const toggleSelectAll = () => {
  if (selectAll.value) {
    selectedEntries.value = unsubmittedEntries.value.map(e => e.id)
  } else {
    selectedEntries.value = []
  }
}

const updateSelectAll = () => {
  selectAll.value = selectedEntries.value.length === unsubmittedEntries.value.length
}

/**
 * Raise a submission notification when the user has them switched on.
 *
 * The three call sites previously repeated the same localStorage parse and
 * guard, which is how the failure path came to be missing one.
 */
const notifySubmission = async (
  pick: (win: Window) => ((arg: string) => Promise<void>) | undefined,
  arg: string
) => {
  try {
    const raw = localStorage.getItem('notificationSettings')
    if (!raw) return
    const settings = JSON.parse(raw)
    if (!settings.enabled || !settings.submissionAlerts) return
    const fn = pick(window)
    if (fn) await fn(arg)
  } catch (e) {
    console.error('Failed to show notification:', e)
  }
}

const submitSelected = async () => {
  if (selectedEntries.value.length === 0) {
    uiStore.showError('Please select entries to submit')
    return
  }

  isSubmitting.value = true
  const entryCount = selectedEntries.value.length
  let submittedTotal = 0
  let skippedTotal = 0
  let failedTotal = 0
  let duplicateTotal = 0
  let futureLimitedTotal = 0
  const failedDates: string[] = []

  try {
    // Group by date and submit each date once, passing only the selected ids.
    // Submitting per entry re-submitted the whole day once per selected row.
    const byDate = new Map<string, string[]>()
    for (const id of selectedEntries.value) {
      const entry = entriesStore.entries.find(e => e.id === id)
      if (!entry) continue
      const list = byDate.get(entry.date) ?? []
      list.push(id)
      byDate.set(entry.date, list)
    }

    // Tempo being unreachable is a property of Tempo, not of one date, so the
    // first verification failure stops the run instead of retrying every
    // remaining date against a service that is evidently down.
    let verificationError: TempoVerificationError | null = null

    // Tempo's future-logging window is a property of the account, so once it
    // rejects one date every later date will be rejected too. Learning the
    // cutoff from Tempo's own response avoids hardcoding a window that each
    // instance can configure, and saves a pointless call per remaining date.
    let futureCutoff: string | null = null

    // Dates are submitted oldest first so that a run which hits the future
    // window has already banked everything Tempo would accept.
    const orderedDates = [...byDate.keys()].sort()

    for (const date of orderedDates) {
      const ids = byDate.get(date) ?? []
      if (futureCutoff && date >= futureCutoff) {
        futureLimitedTotal += ids.length
        continue
      }

      const activityTypeMap: Record<string, string> = {}
      for (const id of ids) {
        const type = activityFor(id)
        if (type) activityTypeMap[id] = type
      }
      try {
        const result = await entriesStore.submitEntries(date, { entryIds: ids, activityTypeMap })
        const futureLimited = result.failedEntries.filter(e => e.futureLimited)
        if (futureLimited.length > 0 && !futureCutoff) futureCutoff = date

        submittedTotal += result.count
        skippedTotal += result.skippedEntries.length
        failedTotal += result.failedEntries.length - futureLimited.length
        futureLimitedTotal += futureLimited.length
        duplicateTotal += result.duplicateEntries.length
        if (result.failedEntries.length > futureLimited.length) failedDates.push(date)
      } catch (err) {
        if (err instanceof TempoVerificationError) { verificationError = err; break }
        // One date failing is not a reason to abandon the rest of the run;
        // the remaining days are independent and may submit perfectly well.
        failedTotal += ids.length
        failedDates.push(date)
      }
    }

    if (verificationError) {
      // Anything already submitted before the failure must still be cleared
      // from the selection, or retrying would offer it a second time.
      selectedEntries.value = selectedEntries.value.filter(id =>
        !entriesStore.entries.find(e => e.id === id)?.submitted
      )
      selectAll.value = false
      entriesStore.syncEntriesPersist()

      if (submittedTotal > 0) {
        await entriesStore.loadSubmissionHistory()
      }

      const message = submittedTotal > 0
        ? `${submittedTotal} of ${entryCount} entries submitted, then Tempo became unreachable ` +
          `on ${verificationError.date}. The rest were not submitted — check Tempo, then try again later.`
        : verificationError.message
      uiStore.showError(message)
      await notifySubmission(win => win.showSubmissionError, message)
      return
    }

    await entriesStore.loadSubmissionHistory()
    // A run can narrow the window, so re-read it before the list redraws.
    await entriesStore.loadTempoFutureLimit()

    selectedEntries.value = []
    selectAll.value = false
    bulkActivityType.value = ''
    activityOverrides.value = {}
    entriesStore.syncEntriesPersist()

    // Reported from what Tempo accepted, not from what was ticked, so a
    // partial submission is never announced as a complete one.
    if (failedTotal > 0 || skippedTotal > 0 || duplicateTotal > 0 || futureLimitedTotal > 0) {
      const detail = [
        failedTotal > 0
          ? `${failedTotal} failed${failedDates.length ? ` (${failedDates.map(formatDate).join(', ')})` : ''}`
          : '',
        futureLimitedTotal > 0 ? `${futureLimitedTotal} dated too far ahead for Tempo` : '',
        duplicateTotal > 0 ? `${duplicateTotal} already in Tempo` : '',
        skippedTotal > 0 ? `${skippedTotal} skipped (no ticket)` : ''
      ].filter(Boolean).join(', ')

      // Entries Tempo will not take yet are the expected outcome of logging
      // future meetings, so on their own they are information, not a problem.
      const onlyFutureLimited = failedTotal === 0 && futureLimitedTotal > 0
      const message = `${submittedTotal} of ${entryCount} entries submitted — ${detail}` +
        (onlyFutureLimited ? '. Submit those nearer the time.' : '')
      if (failedTotal > 0) uiStore.showError(message)
      else uiStore.showInfo(message)
    } else {
      uiStore.showSuccess(`${submittedTotal} entries submitted successfully`)
    }
    
    // Show notification if enabled
    await notifySubmission(win => win.showSubmissionSuccess, new Date().toLocaleDateString())
  } catch (error) {
    const errorMsg = entriesStore.error || 'Failed to submit entries'
    uiStore.showError(errorMsg)
    await notifySubmission(win => win.showSubmissionError, errorMsg)
  } finally {
    isSubmitting.value = false
  }
}

// AI Features

</script>

<style scoped>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

.submit-page {
  min-height: 100vh;
  color: #e2e8f0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

/* Page Header */
.page-header {
  padding: 2rem 3rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  background: rgba(15, 23, 42, 0.5);
  backdrop-filter: blur(10px);
  position: sticky;
  top: 0;
  z-index: 100;
}

.page-header h1 {
  font-size: 1.8rem;
  font-weight: 700;
  margin-bottom: 1rem;
}

.header-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.btn-range {
  padding: 0.5rem 1rem;
  background: rgba(51, 65, 85, 0.5);
  border: 1px solid rgba(148, 163, 184, 0.2);
  color: #cbd5e1;
  border-radius: 0.5rem;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.3s ease;
  font-size: 0.9rem;
}

.btn-range:hover {
  background: rgba(51, 65, 85, 0.8);
  border-color: rgba(148, 163, 184, 0.4);
}

.btn-range.active {
  background: rgba(6, 182, 212, 0.2);
  border-color: #06b6d4;
  color: #06b6d4;
}

/* Date range bar */
.range-bar {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  flex-wrap: wrap;
  padding: 0 3rem 1rem;
}

.custom-range {
  display: flex;
  align-items: flex-end;
  gap: 1rem;
  flex-wrap: wrap;
}

.range-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.8rem;
  color: #94a3b8;
}

.date-input {
  padding: 0.5rem 0.75rem;
  background: rgba(51, 65, 85, 0.5);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.5rem;
  color: #e2e8f0;
  font-size: 0.9rem;
  font-family: inherit;
  color-scheme: dark;
}

.date-input:focus-visible {
  outline: 2px solid #06b6d4;
  outline-offset: 2px;
}

.range-summary {
  font-size: 0.85rem;
  color: #94a3b8;
}

.range-error {
  color: #f87171;
}

/* Content */
.submit-content {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 2rem;
  padding: 2rem 3rem;
  max-width: 1600px;
  margin: 0 auto;
  width: 100%;
}

.submit-left {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

/* Controls */
.controls-section {
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 0.75rem;
  padding: 1.5rem;
  backdrop-filter: blur(10px);
}

.control-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.control-group:last-child {
  margin-bottom: 0;
}

.control-group label {
  font-weight: 600;
  font-size: 0.9rem;
  color: #cbd5e1;
}

.select-control {
  padding: 0.75rem;
  background: rgba(51, 65, 85, 0.5);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.5rem;
  color: #e2e8f0;
  font-size: 0.95rem;
  cursor: pointer;
  transition: all 0.3s ease;
}

.select-control:focus {
  outline: none;
  border-color: #06b6d4;
  background: rgba(51, 65, 85, 0.8);
}

.btn-submit-all {
  width: 100%;
  padding: 0.75rem 1.5rem;
  background: linear-gradient(135deg, #06b6d4, #0891b2);
  color: #0f172a;
  border: none;
  border-radius: 0.5rem;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.3s ease;
  font-size: 0.95rem;
}

.btn-submit-all:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 8px 16px rgba(6, 182, 212, 0.3);
}

.btn-submit-all:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Entries Section */
.entries-section {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 1rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
}

.section-header h2 {
  font-size: 1.3rem;
  font-weight: 700;
}

.entry-count {
  font-size: 0.9rem;
  color: #94a3b8;
}

/* Table */
.entries-table {
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 0.75rem;
  overflow: hidden;
  backdrop-filter: blur(10px);
}

.table-header {
  display: grid;
  grid-template-columns: 40px 110px 1fr 110px 190px 90px;
  gap: 1rem;
  padding: 1rem 1.5rem;
  background: rgba(51, 65, 85, 0.5);
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  font-weight: 600;
  color: #94a3b8;
  text-transform: uppercase;
  font-size: 0.85rem;
  letter-spacing: 0.05em;
}

.table-body {
  max-height: 400px;
  overflow-y: auto;
}

.table-row {
  display: grid;
  grid-template-columns: 40px 110px 1fr 110px 190px 90px;
  gap: 1rem;
  padding: 1rem 1.5rem;
  align-items: center;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  transition: background 0.3s ease;
}

.table-row:hover {
  background: rgba(51, 65, 85, 0.3);
}

.table-row.selected {
  background: rgba(6, 182, 212, 0.1);
}

.col-checkbox {
  display: flex;
  justify-content: center;
}

.col-checkbox input[type="checkbox"],
.table-header .col-checkbox input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: #06b6d4;
}

.col-date {
  color: #cbd5e1;
  font-family: 'Space Mono', monospace;
  font-size: 0.9rem;
}

.col-task {
  color: #e2e8f0;
  font-weight: 500;
}

.col-ticket {
  color: #cbd5e1;
  font-family: 'Space Mono', monospace;
  font-size: 0.9rem;
}

.col-activity {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
}

.select-activity {
  flex: 1;
  min-width: 0;
  padding: 0.3rem 0.4rem;
  background: rgba(15, 23, 42, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 6px;
  color: #e2e8f0;
  font-size: 0.8rem;
}

.source-badge {
  flex-shrink: 0;
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  background: rgba(148, 163, 184, 0.15);
  color: #94a3b8;
}

.source-rule { background: rgba(34, 197, 94, 0.15); color: #4ade80; }
.source-calendar { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
.source-holiday { background: rgba(168, 85, 247, 0.15); color: #c084fc; }
.source-llm { background: rgba(234, 179, 8, 0.15); color: #facc15; }
.source-manual { background: rgba(236, 72, 153, 0.15); color: #f472b6; }

.btn-suggest {
  padding: 0.6rem 1.2rem;
  background: rgba(234, 179, 8, 0.12);
  border: 1px solid rgba(234, 179, 8, 0.35);
  border-radius: 8px;
  color: #facc15;
  font-size: 0.85rem;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-suggest:hover:not(:disabled) { background: rgba(234, 179, 8, 0.22); }
.btn-suggest:disabled { opacity: 0.5; cursor: not-allowed; }

.col-hours {
  color: #06b6d4;
  font-weight: 600;
  text-align: right;
}

/* Empty State */
.blocked-section {
  margin-top: 1.25rem;
  padding: 1rem;
  border: 1px solid rgba(255, 176, 32, 0.35);
  border-radius: 12px;
  background: rgba(255, 176, 32, 0.08);
}

/* A deferral is a "not yet", so it reads as information rather than a
   warning like the no-ticket case above. */
.deferred-section {
  border-color: rgba(96, 165, 250, 0.35);
  background: rgba(96, 165, 250, 0.08);
}

.blocked-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  font-size: 0.9rem;
  margin-bottom: 0.75rem;
}

.blocked-icon {
  font-size: 1rem;
}

.blocked-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.blocked-row {
  display: grid;
  grid-template-columns: 7rem 1fr 5rem;
  gap: 0.75rem;
  padding: 0.4rem 0.5rem;
  border-radius: 6px;
  font-size: 0.85rem;
  opacity: 0.85;
  background: rgba(0, 0, 0, 0.12);
}

.blocked-task {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.blocked-hours {
  text-align: right;
}

.blocked-hint {
  margin-top: 0.75rem;
  font-size: 0.8rem;
  opacity: 0.7;
}

.empty-state {
  text-align: center;
  padding: 3rem;
  color: #94a3b8;
}

.empty-icon {
  font-size: 3rem;
  margin-bottom: 1rem;
}

.empty-state.small {
  padding: 1.5rem;
}

.empty-state.small p {
  margin: 0;
}

/* Sidebar */
.submit-right {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.history-section,
.summary-section {
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 0.75rem;
  padding: 1.5rem;
  backdrop-filter: blur(10px);
}

.history-section h2,
.summary-section h2 {
  font-size: 1.1rem;
  font-weight: 700;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem;
  background: rgba(51, 65, 85, 0.3);
  border-radius: 0.5rem;
  transition: all 0.3s ease;
}

.history-item:hover {
  background: rgba(51, 65, 85, 0.5);
}

.history-item.status-success {
  border-bottom: 2px solid #10b981;
  padding-bottom: calc(0.75rem - 2px);
}

.history-item.status-failed {
  border-bottom: 2px solid #ef4444;
  padding-bottom: calc(0.75rem - 2px);
}

.history-item.status-partial {
  border-bottom: 2px solid #f59e0b;
  padding-bottom: calc(0.75rem - 2px);
}

.history-icon {
  font-size: 1.2rem;
  font-weight: 600;
  min-width: 24px;
  text-align: center;
}

.history-item.status-success .history-icon {
  color: #10b981;
}

.history-item.status-failed .history-icon {
  color: #ef4444;
}

.history-item.status-partial .history-icon {
  color: #f59e0b;
}

.history-content {
  flex: 1;
  min-width: 0;
}

.history-date {
  font-size: 0.85rem;
  color: #cbd5e1;
  font-weight: 500;
}

.history-count {
  font-size: 0.75rem;
  color: #94a3b8;
}

.history-time {
  font-size: 0.7rem;
  color: #64748b;
  margin-top: 0.125rem;
}

.history-status {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: capitalize;
  color: #94a3b8;
  padding: 0.25rem 0.5rem;
  background: rgba(51, 65, 85, 0.5);
  border-radius: 0.25rem;
}

/* Summary */
.summary-stats {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.stat {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem;
  background: rgba(51, 65, 85, 0.3);
  border-radius: 0.5rem;
}

.stat-label {
  font-size: 0.9rem;
  color: #cbd5e1;
  font-weight: 500;
}

.stat-value {
  font-size: 1.2rem;
  font-weight: 700;
  color: #06b6d4;
  font-family: 'Space Mono', monospace;
}

/* Scrollbar */
.table-body::-webkit-scrollbar {
  width: 6px;
}

.table-body::-webkit-scrollbar-track {
  background: transparent;
}

.table-body::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.2);
  border-radius: 3px;
}

.table-body::-webkit-scrollbar-thumb:hover {
  background: rgba(148, 163, 184, 0.4);
}

/* Responsive */
@media (max-width: 1200px) {
  .submit-content {
    grid-template-columns: 1fr;
  }

  .submit-right {
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }
}

@media (max-width: 768px) {
  .page-header {
    padding: 1.5rem;
  }

  .submit-content {
    padding: 1.5rem;
  }

  .table-header,
  .table-row {
    grid-template-columns: 1fr;
    gap: 0.5rem;
  }

  .submit-right {
    grid-template-columns: 1fr;
  }
}
</style>
