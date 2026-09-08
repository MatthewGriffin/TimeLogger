<template>
  <div class="tempo-page page-shell">
    <div class="page-header">
      <div class="header-titles">
        <h1>Tempo Status</h1>
        <p class="page-sub">What is actually recorded in Tempo, not what this app believes it submitted.</p>
      </div>
      <div class="header-actions">
        <button
          v-for="range in ranges"
          :key="range.label"
          :class="['btn-range', { active: selectedRange === range.label }]"
          @click="selectRange(range.label)"
        >
          {{ range.label }}
        </button>
        <button class="btn-refresh" :disabled="isLoading" @click="load">
          {{ isLoading ? '⏳ Loading...' : '🔄 Refresh' }}
        </button>
      </div>
    </div>

    <div class="page-body">
    <div class="date-bar">
      <label>From</label>
      <input v-model="fromDate" type="date" class="date-input" @change="selectedRange = 'Custom'" />
      <label>To</label>
      <input v-model="toDate" type="date" class="date-input" @change="selectedRange = 'Custom'" />
      <span class="range-hint">{{ fromDate }} → {{ toDate }}</span>
    </div>

    <div v-if="errorMessage" class="alert error">⚠️ {{ errorMessage }}</div>

    <div v-if="loaded && !errorMessage" class="summary-cards">
      <div class="card">
        <div class="card-value">{{ totalHours.toFixed(2) }}h</div>
        <div class="card-label">Logged in Tempo</div>
      </div>
      <div class="card">
        <div class="card-value">{{ counts.tempoWorklogs }}</div>
        <div class="card-label">Tempo worklogs</div>
      </div>
      <div class="card" :class="{ warn: counts.missingFromTempo > 0 }">
        <div class="card-value">{{ counts.missingFromTempo }}</div>
        <div class="card-label">Marked sent, absent</div>
      </div>
      <div class="card" :class="{ warn: counts.onlyInTempo > 0 }">
        <div class="card-value">{{ counts.onlyInTempo }}</div>
        <div class="card-label">Only in Tempo</div>
      </div>
      <div class="card">
        <div class="card-value">{{ counts.notSubmitted }}</div>
        <div class="card-label">Not submitted</div>
      </div>
    </div>

    <div v-if="isLoading" class="empty-state">⏳ Reading worklogs from Tempo...</div>

    <template v-if="loaded && !isLoading && !errorMessage">
      <div class="section">
        <div class="section-header">
          <h2>Worklogs in Tempo</h2>
          <span class="count">{{ worklogs.length }}</span>
        </div>

        <div v-if="worklogs.length === 0" class="empty-state">
          No worklogs recorded in Tempo for this range.
        </div>

        <div v-else class="table">
          <div class="table-header">
            <div class="col-date">Date</div>
            <div class="col-time">Start</div>
            <div class="col-ticket">Ticket</div>
            <div class="col-desc">Description</div>
            <div class="col-activity">Activity</div>
            <div class="col-dur">Time</div>
          </div>
          <div v-for="log in worklogs" :key="log.worklogId" class="table-row">
            <div class="col-date">{{ log.date }}</div>
            <div class="col-time">{{ log.startTime }}</div>
            <div class="col-ticket">
              <span class="ticket-chip">{{ log.ticketId || '—' }}</span>
            </div>
            <div class="col-desc" :title="log.description">{{ log.description || '—' }}</div>
            <div class="col-activity">
              <span v-if="log.activityTypeName" class="activity-chip">{{ log.activityTypeName }}</span>
              <span v-else class="muted">—</span>
            </div>
            <div class="col-dur">{{ formatDuration(log.durationMins) }}</div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <h2>Local Entries vs Tempo</h2>
          <span class="count">{{ reconciled.length }}</span>
        </div>

        <div class="filter-row">
          <button
            v-for="filter in statusFilters"
            :key="filter.value"
            :class="['btn-filter', { active: statusFilter === filter.value }]"
            @click="statusFilter = filter.value"
          >
            {{ filter.label }}
          </button>
        </div>

        <div v-if="filteredReconciled.length === 0" class="empty-state">
          Nothing matches this filter.
        </div>

        <div v-else class="table">
          <div class="table-header">
            <div class="col-date">Date</div>
            <div class="col-ticket">Ticket</div>
            <div class="col-desc">Task</div>
            <div class="col-dur">Local</div>
            <div class="col-dur">Tempo</div>
            <div class="col-status">Status</div>
          </div>
          <div
            v-for="row in filteredReconciled"
            :key="row.entryId"
            :class="['table-row', statusClass(row.status)]"
          >
            <div class="col-date">{{ row.date }}</div>
            <div class="col-ticket">
              <span v-if="row.ticketId" class="ticket-chip">{{ row.ticketId }}</span>
              <span v-else class="ticket-chip missing" title="No ticket, so this can never reach Tempo">no ticket</span>
            </div>
            <div class="col-desc" :title="row.name">{{ row.name }}</div>
            <div class="col-dur">{{ formatDuration(row.durationMins) }}</div>
            <div class="col-dur">
              <span v-if="row.tempoDurationMins !== null" :class="{ differs: row.durationDiffers }">
                {{ formatDuration(row.tempoDurationMins) }}
              </span>
              <span v-else class="muted">—</span>
            </div>
            <div class="col-status">
              <span :class="['status-chip', statusClass(row.status)]">{{ statusLabel(row.status) }}</span>
            </div>
          </div>
        </div>
      </div>

      <p v-if="importMessage" class="import-message">{{ importMessage }}</p>

      <div v-if="unmatchedWorklogs.length > 0" class="section">
        <div class="section-header">
          <h2>In Tempo Only</h2>
          <span class="count">{{ unmatchedWorklogs.length }}</span>
          <button
            class="import-all-btn"
            :disabled="isImporting"
            @click="importWorklogs()"
          >
            {{ isImporting ? 'Importing…' : '⬇ Pull All To Local' }}
          </button>
        </div>
        <p class="section-note">
          Logged directly in Tempo with no matching entry here — for example time booked from the Tempo web UI.
          Pulling one down creates a local entry already marked as submitted.
        </p>
        <div class="table table-5col">
          <div class="table-header">
            <div class="col-date">Date</div>
            <div class="col-ticket">Ticket</div>
            <div class="col-desc">Description</div>
            <div class="col-dur">Time</div>
            <div class="col-action"></div>
          </div>
          <div v-for="log in unmatchedWorklogs" :key="log.worklogId" class="table-row only-tempo">
            <div class="col-date">{{ log.date }}</div>
            <div class="col-ticket"><span class="ticket-chip">{{ log.ticketId || '—' }}</span></div>
            <div class="col-desc" :title="log.description">{{ log.description || '—' }}</div>
            <div class="col-dur">{{ formatDuration(log.durationMins) }}</div>
            <div class="col-action">
              <button
                class="import-btn"
                :disabled="isImporting || !log.ticketId"
                :title="log.ticketId ? 'Create a local entry from this worklog' : 'No ticket resolved for this worklog'"
                @click="importWorklogs([log.worklogId])"
              >
                Pull down
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { executeApi, ApiError } from '@/shared/utils/api'
import { asRecord, asString, asNumber, asBoolean, readList } from '@/shared/utils/schema'
import { localDate, startOfWeek } from '@/shared/utils/dates'

interface TempoWorklog {
  worklogId: number
  ticketId: string | null
  description: string
  date: string
  startTime: string
  durationMins: number
  activityTypeName: string | null
}

interface ReconciledRow {
  entryId: number
  date: string
  name: string
  ticketId: string | null
  durationMins: number
  submitted: boolean
  status: string
  tempoDurationMins: number | null
  durationDiffers: boolean
}

const isLoading = ref(false)
const isImporting = ref(false)
const importMessage = ref('')
const loaded = ref(false)
const errorMessage = ref('')
const worklogs = ref<TempoWorklog[]>([])
const reconciled = ref<ReconciledRow[]>([])
const unmatchedWorklogs = ref<TempoWorklog[]>([])
const totalHours = ref(0)
const statusFilter = ref('all')

const counts = ref({
  tempoWorklogs: 0,
  localEntries: 0,
  matched: 0,
  missingFromTempo: 0,
  inTempoNotMarked: 0,
  notSubmitted: 0,
  onlyInTempo: 0
})

const shiftDays = (days: number) => {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return localDate(date)
}

const ranges = [
  { label: 'Today', from: () => localDate(new Date()) },
  // Monday of the current week, not a rolling 7 days, so "This Week" means the
  // same span here as it does on the Submit page.
  { label: 'This Week', from: () => localDate(startOfWeek()) },
  { label: 'Last 30 Days', from: () => shiftDays(-29) }
]

// Open on today, so the page lands on the summary for the day being worked
// on rather than a week of history. Derived from the range list so the
// active button and the dates it implies cannot drift apart.
const DEFAULT_RANGE = 'Today'
const defaultRange = () => ranges.find(item => item.label === DEFAULT_RANGE)

const selectedRange = ref(DEFAULT_RANGE)
const fromDate = ref(defaultRange()?.from() ?? localDate(new Date()))
const toDate = ref(localDate(new Date()))

const statusFilters = [
  { label: 'All', value: 'all' },
  { label: 'Matched', value: 'matched' },
  { label: 'Marked sent, absent', value: 'missing_from_tempo' },
  { label: 'In Tempo, not marked', value: 'in_tempo_not_marked' },
  { label: 'Not submitted', value: 'not_submitted' }
]

const filteredReconciled = computed(() =>
  statusFilter.value === 'all'
    ? reconciled.value
    : reconciled.value.filter(row => row.status === statusFilter.value)
)

const statusLabel = (status: string) => {
  switch (status) {
    case 'matched': return 'In Tempo'
    case 'missing_from_tempo': return 'Marked sent, absent'
    case 'in_tempo_not_marked': return 'In Tempo, not marked'
    default: return 'Not submitted'
  }
}

const statusClass = (status: string) => {
  switch (status) {
    case 'matched': return 'ok'
    case 'missing_from_tempo': return 'bad'
    case 'in_tempo_not_marked': return 'warn'
    default: return 'pending'
  }
}

const formatDuration = (mins: number | null) => {
  if (mins === null || mins === undefined) return '—'
  const hours = Math.floor(mins / 60)
  const minutes = mins % 60
  if (hours === 0) return `${minutes}m`
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
}

const selectRange = (label: string) => {
  const range = ranges.find(item => item.label === label)
  if (!range) return
  selectedRange.value = label
  fromDate.value = range.from()
  toDate.value = localDate(new Date())
  load()
}

const parseWorklog = (item: Record<string, unknown>): TempoWorklog => ({
  worklogId: asNumber(item.worklogId),
  ticketId: item.ticketId ? asString(item.ticketId) : null,
  description: asString(item.description),
  date: asString(item.date),
  startTime: asString(item.startTime),
  durationMins: asNumber(item.durationMins),
  activityTypeName: item.activityTypeName ? asString(item.activityTypeName) : null
})

const load = async () => {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const raw = await executeApi('tempo_get_worklogs', { from: fromDate.value, to: toDate.value })
    const record = asRecord(raw)

    if (!asBoolean(record.success, false)) {
      errorMessage.value = asString(record.message, 'Failed to read Tempo worklogs')
      loaded.value = true
      return
    }

    worklogs.value = readList(record.worklogs, undefined, parseWorklog)
    unmatchedWorklogs.value = readList(record.unmatchedWorklogs, undefined, parseWorklog)
    reconciled.value = readList(record.reconciled, undefined, item => ({
      entryId: asNumber(item.entryId),
      date: asString(item.date),
      name: asString(item.name),
      ticketId: item.ticketId ? asString(item.ticketId) : null,
      durationMins: asNumber(item.durationMins),
      submitted: asBoolean(item.submitted, false),
      status: asString(item.status, 'not_submitted'),
      tempoDurationMins: item.tempoDurationMins === null || item.tempoDurationMins === undefined
        ? null
        : asNumber(item.tempoDurationMins),
      durationDiffers: asBoolean(item.durationDiffers, false)
    }))

    const rawCounts = asRecord(record.counts)
    counts.value = {
      tempoWorklogs: asNumber(rawCounts.tempoWorklogs),
      localEntries: asNumber(rawCounts.localEntries),
      matched: asNumber(rawCounts.matched),
      missingFromTempo: asNumber(rawCounts.missingFromTempo),
      inTempoNotMarked: asNumber(rawCounts.inTempoNotMarked),
      notSubmitted: asNumber(rawCounts.notSubmitted),
      onlyInTempo: asNumber(rawCounts.onlyInTempo)
    }
    totalHours.value = asNumber(record.totalTempoHours)
    loaded.value = true
  } catch (err) {
    errorMessage.value = err instanceof ApiError ? err.message : 'Failed to read Tempo worklogs'
    loaded.value = true
  } finally {
    isLoading.value = false
  }
}

onMounted(load)

const importWorklogs = async (worklogIds?: number[]) => {
  isImporting.value = true
  importMessage.value = ''
  try {
    const result = await executeApi('tempo_import_worklogs', {
      from: fromDate.value,
      to: toDate.value,
      ...(worklogIds ? { worklogIds } : {})
    })
    const record = asRecord(result)

    if (!asBoolean(record.success, false)) {
      importMessage.value = asString(record.message, 'Failed to import worklogs')
      return
    }

    importMessage.value = asString(record.message, 'Import complete')

    const overlaps = readList(record.overlappedEntries, undefined, item => ({
      date: asString(item.date),
      imported: asString(item.imported),
      conflictsWith: asString(item.conflictsWith)
    }))
    if (overlaps.length > 0) {
      importMessage.value += ` — check ${overlaps
        .map(o => `${o.date} ${o.imported} vs ${o.conflictsWith}`)
        .join('; ')}`
    }

    // Re-reconcile so imported rows leave the "In Tempo Only" list.
    await load()
  } catch (err) {
    importMessage.value = err instanceof ApiError ? err.message : 'Failed to import worklogs'
  } finally {
    isImporting.value = false
  }
}
</script>

<style scoped>
.page-header {
  align-items: flex-start;
  gap: var(--space-md);
  flex-wrap: wrap;
}

.page-header h1 {
  font-size: 1.625rem;
  font-weight: 700;
}

.page-sub {
  margin-top: var(--space-2xs);
  font-size: 0.8125rem;
  color: var(--color-text-subtle);
}

.header-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.btn-range,
.btn-refresh,
.btn-filter {
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid var(--color-control-solid);
  background: #1e293b;
  color: var(--color-text-muted);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-range:hover,
.btn-refresh:hover,
.btn-filter:hover {
  background: var(--color-control-solid);
  color: #f1f5f9;
}

.btn-range.active,
.btn-filter.active {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: var(--color-on-accent);
}

.btn-refresh:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.date-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  background: #1e293b;
  border: 1px solid var(--color-control-solid);
  border-radius: 10px;
  padding: 12px 16px;
  margin-bottom: 20px;
}

.date-bar label {
  font-size: 13px;
  color: var(--color-text-subtle);
}

.date-input {
  background: var(--color-surface);
  border: 1px solid var(--color-control-solid);
  border-radius: 6px;
  color: var(--color-text);
  padding: 6px 10px;
  font-size: 13px;
}

.range-hint {
  margin-left: auto;
  font-size: 12px;
  color: #64748b;
}

.alert {
  padding: 12px 16px;
  border-radius: 8px;
  margin-bottom: 20px;
  font-size: 14px;
}

.alert.error {
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: var(--color-danger-soft);
}

.summary-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}

.card {
  background: #1e293b;
  border: 1px solid var(--color-control-solid);
  border-radius: 10px;
  padding: 16px;
}

.card.warn {
  border-color: rgba(245, 158, 11, 0.5);
  background: rgba(245, 158, 11, 0.08);
}

.card-value {
  font-size: 24px;
  font-weight: 700;
  color: #f1f5f9;
}

.card-label {
  font-size: 12px;
  color: var(--color-text-subtle);
  margin-top: 4px;
}

.section {
  background: #1e293b;
  border: 1px solid var(--color-control-solid);
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 20px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}

.section-header h2 {
  font-size: 17px;
  font-weight: 600;
}

.count {
  background: var(--color-control-solid);
  color: var(--color-text-muted);
  border-radius: 20px;
  padding: 2px 10px;
  font-size: 12px;
}

.section-note {
  font-size: 13px;
  color: var(--color-text-subtle);
  margin-bottom: 12px;
}

.filter-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.table {
  border: 1px solid var(--color-control-solid);
  border-radius: 8px;
  overflow: hidden;
}

.table-header,
.table-row {
  display: grid;
  grid-template-columns: 110px 70px 130px 1fr 130px 90px;
  gap: 10px;
  padding: 10px 14px;
  align-items: center;
  font-size: 13px;
}

.table-header {
  background: var(--color-surface);
  color: var(--color-text-subtle);
  font-weight: 600;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.table-row {
  border-top: 1px solid var(--color-control-solid);
}

/* The reconcile and Tempo-only tables have different column counts, so the
   shared grid has to be restated rather than inherited. */
.table-4col .table-header,
.table-4col .table-row {
  grid-template-columns: 110px 130px 1fr 90px;
}

.table-5col .table-header,
.table-5col .table-row {
  grid-template-columns: 110px 130px 1fr 90px 100px;
}

.col-action {
  display: flex;
  justify-content: flex-end;
}

.import-btn {
  padding: 5px 10px;
  border: 1px solid var(--color-accent-ring);
  border-radius: 6px;
  background: var(--color-accent-soft);
  color: var(--color-accent);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.import-btn:hover:not(:disabled) {
  background: var(--color-accent-muted);
}

.import-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.import-all-btn {
  margin-left: auto;
  padding: 6px 12px;
  border: 1px solid var(--color-accent-ring);
  border-radius: 6px;
  background: var(--color-accent-soft);
  color: var(--color-accent);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.import-all-btn:hover:not(:disabled) {
  background: var(--color-accent-muted);
}

.import-all-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.import-message {
  margin-bottom: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.35);
  color: #bfdbfe;
  font-size: 13px;
}

.table-row:hover {
  background: rgba(148, 163, 184, 0.06);
}

.table-row.bad {
  background: rgba(239, 68, 68, 0.08);
}

.table-row.warn {
  background: rgba(245, 158, 11, 0.08);
}

.table-row.only-tempo {
  background: rgba(59, 130, 246, 0.06);
}

.col-desc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ticket-chip {
  background: var(--color-control-solid);
  color: #93c5fd;
  border-radius: 5px;
  padding: 2px 8px;
  font-size: 12px;
  font-family: 'Consolas', monospace;
}

.ticket-chip.missing {
  background: rgba(239, 68, 68, 0.18);
  color: var(--color-danger-soft);
  font-family: inherit;
}

.activity-chip {
  background: rgba(59, 130, 246, 0.15);
  color: #93c5fd;
  border-radius: 5px;
  padding: 2px 8px;
  font-size: 12px;
}

.status-chip {
  border-radius: 20px;
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.status-chip.ok {
  background: rgba(34, 197, 94, 0.15);
  color: #86efac;
}

.status-chip.bad {
  background: rgba(239, 68, 68, 0.18);
  color: var(--color-danger-soft);
}

.status-chip.warn {
  background: rgba(245, 158, 11, 0.18);
  color: #fcd34d;
}

.status-chip.pending {
  background: rgba(148, 163, 184, 0.15);
  color: var(--color-text-muted);
}

.differs {
  color: #fcd34d;
  font-weight: 600;
}

.muted {
  color: #64748b;
}

.empty-state {
  padding: 32px;
  font-size: 14px;
}

</style>
