<template>
  <div class="dashboard page-shell">
    <!-- Page Header -->
    <div class="page-header">
      <div class="header-content">
        <h1>Dashboard</h1>
        <div class="current-time">
          <span class="time-display">{{ currentTime }}</span>
          <span class="date-display">{{ currentDate }}</span>
        </div>
      </div>
      <div class="quick-actions">
        <router-link to="/entries" class="btn-link">+ Add Entry</router-link>
      </div>
    </div>

    <!-- Configuration Status Banner -->
    <ConfigurationStatus />

    <!-- Main content area -->
    <div class="dashboard-content page-body">
      <!-- Quick Stats -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon">⏱️</div>
          <div class="stat-content">
            <div class="stat-label">Today's Hours</div>
            <div class="stat-value">{{ todayHours }}</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">📅</div>
          <div class="stat-content">
            <div class="stat-label">This Week</div>
            <div class="stat-value">{{ weekHours }}</div>
          </div>
        </div>
        <router-link
          to="/submit"
          class="stat-card stat-card-link"
          :class="{ 'stat-card-attention': unsubmitted.count > 0 }"
        >
          <div class="stat-icon">📤</div>
          <div class="stat-content">
            <div class="stat-label">Unsubmitted</div>
            <div class="stat-value">{{ unsubmitted.hours }}</div>
            <div class="stat-detail">
              {{ unsubmitted.count === 0
                ? 'All caught up'
                : `${unsubmitted.count} ${unsubmitted.count === 1 ? 'entry' : 'entries'} this week` }}
            </div>
          </div>
        </router-link>
        <div class="stat-card">
          <div class="stat-icon">📊</div>
          <div class="stat-content">
            <div class="stat-label">Missed Days</div>
            <div class="stat-value">{{ missedDaysCount }}</div>
            <div v-if="missedDaysCount" class="missed-days">
              <button
                v-for="day in entriesStore.missedDays"
                :key="day"
                type="button"
                class="missed-day"
                @click="openDay(day)"
              >
                {{ formatMissedDay(day) }}
              </button>
            </div>
          </div>
        </div>

        <div class="dashboard-panels">
          <section class="dashboard-panel tempo-panel">
            <div class="panel-heading">
              <div>
                <h2 class="section-title">Tempo health</h2>
                <p class="panel-subtitle">{{ tempoSummary.lastChecked ? `Checked ${formatCheckedTime(tempoSummary.lastChecked)}` : 'Not checked yet' }}</p>
              </div>
              <router-link to="/tempo" class="panel-link">Open Tempo Status →</router-link>
            </div>
            <div class="panel-metrics">
              <div><strong>{{ tempoSummary.missing }}</strong><span>Missing</span></div>
              <div><strong>{{ tempoSummary.different }}</strong><span>Duration differs</span></div>
              <div><strong>{{ tempoSummary.only }}</strong><span>Tempo only</span></div>
            </div>
            <p class="panel-message" :class="{ warning: tempoSummary.error || tempoSummary.missing || tempoSummary.different || tempoSummary.only }">
              {{ tempoSummary.error || tempoHealthMessage }}
            </p>
          </section>

          <section class="dashboard-panel">
            <div class="panel-heading">
              <div>
                <h2 class="section-title">Today’s submission</h2>
                <p class="panel-subtitle">{{ todayTicketedCount }} ticketed entries</p>
              </div>
              <router-link to="/submit" class="panel-link">Submit time →</router-link>
            </div>
            <div class="progress-track"><span :style="{ width: `${todaySubmissionPercent}%` }"></span></div>
            <p class="panel-message">{{ todaySubmissionMessage }}</p>
          </section>

          <section class="dashboard-panel">
            <div class="panel-heading">
              <div>
                <h2 class="section-title">Workday target</h2>
                <p class="panel-subtitle">{{ workdayTarget }}h scheduled</p>
              </div>
              <router-link to="/settings" class="panel-link">Edit hours →</router-link>
            </div>
            <div class="progress-track"><span :style="{ width: `${workdayPercent}%` }"></span></div>
            <p class="panel-message">{{ todayHours }}h logged · {{ workdayRemaining }}h remaining</p>
          </section>

          <section class="dashboard-panel">
            <div class="panel-heading">
              <div>
                <h2 class="section-title">Needs attention</h2>
                <p class="panel-subtitle">{{ attentionCount ? `${attentionCount} item${attentionCount === 1 ? '' : 's'}` : 'Nothing outstanding' }}</p>
              </div>
              <router-link to="/entries" class="panel-link">Review entries →</router-link>
            </div>
            <p class="panel-message" :class="{ warning: attentionCount > 0 }">
              {{ attentionMessage }}
            </p>
          </section>
        </div>

        <section class="dashboard-panel submission-history-panel">
          <div class="panel-heading">
            <div>
              <h2 class="section-title">Recent submissions</h2>
              <p class="panel-subtitle">The last uploads recorded by TimeLogger</p>
            </div>
            <router-link to="/submit" class="panel-link">View submit page →</router-link>
          </div>
          <div v-if="entriesStore.submissionHistory.length" class="submission-history">
            <div v-for="run in entriesStore.submissionHistory.slice(0, 5)" :key="run.id" class="submission-row">
              <span>{{ run.date }}</span>
              <span>{{ run.entryCount }} entries</span>
              <span :class="['submission-status', run.status]">{{ run.status }}{{ run.failedCount ? ` · ${run.failedCount} failed` : '' }}</span>
            </div>
          </div>
          <p v-else class="panel-message">No Tempo submissions recorded yet.</p>
        </section>
      </div>

      <!-- Recent Activity -->
      <div class="activity-section">
        <h2 class="section-title">Recent Activity</h2>
        <div class="activity-list">
          <p v-if="!recentActivity.length" class="activity-empty">
            No time logged yet this week.
          </p>
          <div class="activity-item" v-for="(item, idx) in recentActivity" :key="idx">
            <div class="activity-time">{{ formatActivityTime(item.timestamp) }}</div>
            <div class="activity-content">
              <div class="activity-title">{{ item.title }}</div>
              <div class="activity-description">{{ item.description }}</div>
            </div>
            <div class="activity-icon">{{ item.icon }}</div>
          </div>
        </div>
      </div>

      <!-- Integration Status -->
      <div class="integrations-section">
        <h2 class="section-title">Integrations</h2>
        <div class="integrations-grid">
          <div class="integration-card" :class="integrationClass('jira')">
            <div class="integration-icon">🔗</div>
            <div class="integration-name">Jira</div>
            <div class="integration-status">{{ integrationLabel('jira') }}</div>
          </div>
          <div class="integration-card" :class="integrationClass('microsoft')">
            <div class="integration-icon">📅</div>
            <div class="integration-name">Microsoft</div>
            <div class="integration-status">{{ integrationLabel('microsoft') }}</div>
          </div>
          <div class="integration-card" :class="integrationClass('tempo')">
            <div class="integration-icon">⏱️</div>
            <div class="integration-name">Tempo</div>
            <div class="integration-status">{{ integrationLabel('tempo') }}</div>
          </div>
          <div class="integration-card" :class="integrationClass('ollama')">
            <div class="integration-icon">🤖</div>
            <div class="integration-name">Ollama</div>
            <div class="integration-status">{{ integrationLabel('ollama') }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useEntriesStore } from '@/shared/stores/entries'
import { useConfigStore } from '@/shared/stores/config'
import { useAppStore } from '@/shared/stores/app'
import { localDate, startOfWeek, parseDateKey } from '@/shared/utils/dates'
import { executeApi } from '@/shared/utils/api'
import { asBoolean, asRecord, readList } from '@/shared/utils/schema'
import ConfigurationStatus from '@/features/dashboard/components/ConfigurationStatus.vue'

const router = useRouter()
const entriesStore = useEntriesStore()
const configStore = useConfigStore()
const appStore = useAppStore()

const currentTime = ref('00:00')
const currentDate = ref('')

const integrationLabel = (key: 'jira' | 'microsoft' | 'ollama' | 'tempo') => {
  const health = configStore.integrationHealth[key]
  if (health === 'failed') return '⚠ Failed last use'
  if (key === 'jira') return configStore.config.jira?.baseUrl ? '✓ Configured' : '○ Not enabled'
  if (key === 'microsoft') return configStore.config.microsoft?.tenantId ? '✓ Configured' : '○ Not enabled'
  if (key === 'ollama') return configStore.config.ollama?.host ? '✓ Configured' : '○ Not enabled'
  if (key === 'tempo') return configStore.config.jira?.tempoToken ? '✓ Configured' : '○ Not enabled'
  return '○ Not enabled'
}

const integrationClass = (key: 'jira' | 'microsoft' | 'ollama' | 'tempo') => {
  const health = configStore.integrationHealth[key]
  return {
    configured: health === 'configured' || integrationLabel(key) === '✓ Configured',
    failed: health === 'failed'
  }
}

const missedDaysCount = computed(() => entriesStore.missedDays.length)

const todayHours = computed(() => entriesStore.getTodayHours)
const weekHours = computed(() => entriesStore.getWeekHours)

// The figure the app exists to surface: time recorded but not yet in Tempo.
// Scoped to the current week because that is the range loaded into the cache
// on mount, so it is a number the dashboard can actually stand behind.
const unsubmitted = computed(() => {
  const start = startOfWeek()
  const pending = entriesStore.entries.filter(entry => {
    if (entry.submitted) return false
    // Entries without a ticket (for example Lunch) cannot be submitted to
    // Tempo and should not appear as outstanding work.
    if (!entry.ticketId || !entry.ticketId.trim()) return false
    const date = parseDateKey(entry.date)
    return !!date && date >= start
  })

  return {
    count: pending.length,
    hours: (pending.reduce((sum, entry) => sum + entry.duration, 0) / 60).toFixed(1)
  }
})

const tempoSummary = ref({ missing: 0, different: 0, only: 0, lastChecked: '', error: '' })
const todayTicketed = computed(() => entriesStore.getTodayEntries().filter(entry => Boolean(entry.ticketId?.trim())))
const todayTicketedCount = computed(() => todayTicketed.value.length)
const todaySubmittedCount = computed(() => todayTicketed.value.filter(entry => entry.submitted).length)
const todaySubmissionPercent = computed(() => todayTicketedCount.value
  ? Math.round((todaySubmittedCount.value / todayTicketedCount.value) * 100)
  : 0)
const todaySubmissionMessage = computed(() => todayTicketedCount.value === 0
  ? 'No ticketed time recorded today.'
  : todaySubmittedCount.value === todayTicketedCount.value
    ? 'All ticketed time is submitted.'
    : `${todayTicketedCount.value - todaySubmittedCount.value} ticketed ${todayTicketedCount.value - todaySubmittedCount.value === 1 ? 'entry remains' : 'entries remain'} to submit.`)
const workdayTarget = computed(() => {
  const workday = configStore.config.workday
  if (!workday) return '8.0'
  const [startHour, startMinute] = workday.startTime.split(':').map(Number)
  const [endHour, endMinute] = workday.endTime.split(':').map(Number)
  return ((endHour * 60 + endMinute - startHour * 60 - startMinute) / 60).toFixed(1)
})
const workdayPercent = computed(() => Math.min(100, Math.round((Number(todayHours.value) / Number(workdayTarget.value)) * 100)) || 0)
const workdayRemaining = computed(() => Math.max(0, Number(workdayTarget.value) - Number(todayHours.value)).toFixed(1))
const attentionCount = computed(() => unsubmitted.value.count + entriesStore.pendingMeetingConflicts.length + tempoSummary.value.missing + tempoSummary.value.different)
const attentionMessage = computed(() => {
  if (entriesStore.pendingMeetingConflicts.length) return `${entriesStore.pendingMeetingConflicts.length} calendar conflict${entriesStore.pendingMeetingConflicts.length === 1 ? '' : 's'} need resolving.`
  if (unsubmitted.value.count) return `${unsubmitted.value.count} ticketed entr${unsubmitted.value.count === 1 ? 'y remains' : 'ies remain'} unsubmitted.`
  if (tempoSummary.value.missing || tempoSummary.value.different) return 'Tempo has differences to reconcile.'
  return 'Your entries and integrations look up to date.'
})
const tempoHealthMessage = computed(() => {
  if (!configStore.isTempoConfigured()) return 'Configure Tempo to see reconciliation health.'
  if (!tempoSummary.value.missing && !tempoSummary.value.different && !tempoSummary.value.only) return 'No differences found in this week’s range.'
  return 'Review the differences in Tempo Status.'
})
const formatCheckedTime = (timestamp: string) => new Date(timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

const loadTempoSummary = async () => {
  if (!configStore.isTempoConfigured()) return
  try {
    const record = asRecord(await executeApi('tempo_get_worklogs', {
      from: localDate(startOfWeek()),
      to: localDate()
    }))
    if (!asBoolean(record.success, false)) {
      tempoSummary.value.error = String(record.message || 'Tempo status unavailable')
      return
    }
    const reconciled = readList<Record<string, unknown>>(record.reconciled, undefined, item => item)
    tempoSummary.value = {
      missing: reconciled.filter(row => String(row.status) === 'missing_from_tempo').length,
      different: reconciled.filter(row => Boolean(row.durationDiffers)).length,
      only: readList(record.unmatchedWorklogs, undefined, item => item).length,
      lastChecked: new Date().toISOString(),
      error: ''
    }
  } catch {
    tempoSummary.value.error = 'Tempo status unavailable'
  }
}

const recentActivity = computed(() => {
  return entriesStore.entries
    // An entry's date is only a calendar day, so the time of day has to come
    // from startTime or every item collapses to midnight and the relative
    // times below become meaningless.
    .map(entry => ({
      timestamp: new Date(`${entry.date}T${entry.startTime || '00:00'}:00`).getTime(),
      title: entry.taskName,
      description: `${formatDuration(entry.duration)} logged${entry.ticketId ? ` to ${entry.ticketId}` : ''}`,
      icon: entry.submitted ? '✅' : '✓'
    }))
    .filter(item => Number.isFinite(item.timestamp))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 5)
})

// Update current time
const updateTime = () => {
  const now = new Date()
  // en-GB with a 24-hour clock, matching the entries table and the rest of the
  // app; this pair was previously en-US and 12-hour.
  currentTime.value = now.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })

  currentDate.value = now.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  })
}

const formatDuration = (minutes: number) => {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return `${rest}m`
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

// Format activity time
const formatActivityTime = (timestamp: number) => {
  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)

  // An entry can be logged against a time later today, which would otherwise
  // render as a negative "-45m ago".
  if (diff < 0) return 'Later today'
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  return new Date(timestamp).toLocaleDateString('en-GB')
}

// Missed days are only useful if they can be acted on, so send the user to
// that day's entries rather than just counting them.
const openDay = (date: string) => {
  entriesStore.selectedDate = date
  router.push('/entries')
}

const formatMissedDay = (date: string) => {
  const parsed = parseDateKey(date)
  return parsed
    ? parsed.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
    : date
}

// Lifecycle
let timeInterval: ReturnType<typeof setInterval> | undefined

// Registered at the top level of setup, not inside onMounted. Vue can only
// attach a lifecycle hook while a component instance is current, which is no
// longer true after the first `await` in an async onMounted - so registering
// it there silently failed and leaked the interval on every visit.
onUnmounted(() => {
  clearInterval(timeInterval)
})

onMounted(async () => {
  updateTime()
  timeInterval = setInterval(updateTime, 1000)

  try {
    await appStore.initializeApp()
  } catch (error) {
    console.error('Failed to load dashboard data:', error)
  }

  // The week stats read from the entry cache, which only holds dates the user
  // has actually opened. Without this the week would be under-reported as just
  // today. Not awaited with the above: the day's figures should render first.
  entriesStore.loadEntriesRange(localDate(startOfWeek()), localDate())
    .catch(() => { /* today's figures still stand if the week fails to load */ })

  // Deliberately not awaited with the above: the count is a secondary stat and
  // should never hold up the dashboard rendering.
  entriesStore.loadMissedDays()
  entriesStore.loadSubmissionHistory(5)
  loadTempoSummary()
})
</script>

<style scoped>
/* Page Header */
.header-content {
  display: flex;
  align-items: center;
  gap: 3rem;
}

.page-header h1 {
  font-size: 1.8rem;
  font-weight: 700;
  letter-spacing: -0.5px;
}

.current-time {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.time-display {
  font-size: 1.5rem;
  font-weight: 600;
  font-family: 'Space Mono', monospace;
  color: var(--color-accent);
  letter-spacing: 0.05em;
}

.date-display {
  font-size: 0.875rem;
  color: var(--color-text-subtle);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.quick-actions {
  display: flex;
  gap: 1rem;
}

.btn-link {
  padding: 0.75rem 1.5rem;
  background: linear-gradient(135deg, var(--color-accent), var(--color-accent-strong));
  color: var(--color-on-accent);
  border: none;
  border-radius: 0.5rem;
  cursor: pointer;
  font-weight: 600;
  text-decoration: none;
  transition: all 0.3s ease;
  font-size: 0.95rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.btn-link:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 16px var(--color-accent-ring);
}

/* Content */

/* Stats Grid */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-lg);
  margin-bottom: var(--space-2xl);
}

.dashboard-panels {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-lg);
  margin-bottom: var(--space-2xl);
}

.dashboard-panel {
  padding: 1.25rem 1.5rem;
  background: linear-gradient(135deg, rgba(30, 41, 59, 0.8), rgba(15, 23, 42, 0.6));
  border: 1px solid var(--color-border);
  border-radius: 0.75rem;
  backdrop-filter: blur(10px);
}

.submission-history-panel {
  margin-bottom: var(--space-2xl);
}

.panel-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.panel-heading .section-title {
  margin: 0;
}

.panel-subtitle {
  margin: 0.25rem 0 0;
  color: var(--color-text-subtle);
  font-size: 0.8rem;
}

.panel-link {
  color: var(--color-accent);
  font-size: 0.8rem;
  text-decoration: none;
  white-space: nowrap;
}

.panel-metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
  margin: 1.25rem 0 0.75rem;
}

.panel-metrics div {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.panel-metrics strong {
  font-size: 1.4rem;
}

.panel-metrics span {
  color: var(--color-text-subtle);
  font-size: 0.75rem;
}

.panel-message {
  margin: 0.9rem 0 0;
  color: var(--color-text-muted);
  font-size: 0.85rem;
}

.panel-message.warning {
  color: var(--color-accent);
}

.progress-track {
  height: 0.5rem;
  margin-top: 1.5rem;
  overflow: hidden;
  background: var(--color-control);
  border-radius: 999px;
}

.progress-track span {
  display: block;
  height: 100%;
  background: var(--color-accent);
  border-radius: inherit;
  transition: width 0.3s ease;
}

.submission-history {
  display: flex;
  flex-direction: column;
  margin-top: 1rem;
}

.submission-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 1rem;
  padding: 0.7rem 0;
  border-top: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: 0.85rem;
}

.submission-status {
  color: var(--color-success);
  text-align: right;
  text-transform: capitalize;
}

.submission-status.partial,
.submission-status.failed {
  color: var(--color-accent);
}

.stat-card {
  display: flex;
  gap: 1.5rem;
  padding: 1.5rem;
  background: linear-gradient(135deg, rgba(30, 41, 59, 0.8), rgba(15, 23, 42, 0.6));
  border: 1px solid var(--color-border);
  border-radius: 0.75rem;
  backdrop-filter: blur(10px);
  transition: all 0.3s ease;
  animation: slideUp 0.6s ease-out forwards;
}

.stat-card:nth-child(1) { animation-delay: 0s; }
.stat-card:nth-child(2) { animation-delay: 0.1s; }
.stat-card:nth-child(3) { animation-delay: 0.2s; }
.stat-card:nth-child(4) { animation-delay: 0.3s; }

.stat-card-link {
  text-decoration: none;
  color: inherit;
}

.stat-card-link:hover {
  border-color: var(--color-border-stronger);
}

/* Outstanding time is the one number on this page that asks for action, so it
   is the only card that changes colour. */
.stat-card-attention {
  border-color: var(--color-accent-ring);
}

.stat-card-attention .stat-value {
  color: var(--color-accent);
}

.stat-detail {
  font-size: 0.8rem;
  color: var(--color-text-subtle);
}

.missed-days {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

.missed-day {
  padding: 0.2rem 0.5rem;
  font-size: 0.75rem;
  font-family: inherit;
  color: var(--color-text-muted);
  background: var(--color-control);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: var(--transition);
}

.missed-day:hover {
  background: var(--color-control-hover);
  color: var(--color-text);
}

.activity-empty {
  color: var(--color-text-subtle);
  font-size: 0.9rem;
}

.stat-card:hover {
  border-color: var(--color-border-stronger);
  background: linear-gradient(135deg, rgba(30, 41, 59, 1), rgba(20, 30, 50, 0.8));
  transform: translateY(-2px);
}

.stat-icon {
  font-size: 2.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 4rem;
  height: 4rem;
  background: var(--color-accent-soft);
  border-radius: 0.5rem;
  flex-shrink: 0;
}

.stat-content {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.5rem;
}

.stat-label {
  font-size: 0.875rem;
  color: var(--color-text-subtle);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
}

.stat-value {
  font-size: 2rem;
  font-weight: 700;
  font-family: 'Space Mono', monospace;
  color: var(--color-accent);
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Integrations */
.integrations-section {
  margin-bottom: var(--space-2xl);
}

.integrations-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-lg);
}

.integration-card {
  padding: 1.5rem;
  background: linear-gradient(135deg, rgba(30, 41, 59, 0.8), rgba(15, 23, 42, 0.6));
  border: 1px solid var(--color-border);
  border-radius: 0.75rem;
  text-align: center;
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  align-items: center;
}

.integration-card.configured {
  border-color: rgba(16, 185, 129, 0.3);
  background: linear-gradient(135deg, rgba(30, 41, 59, 0.9), rgba(15, 23, 42, 0.7));
}

.integration-card.failed {
  border-color: rgba(248, 113, 113, 0.35);
}

.integration-card:hover {
  border-color: var(--color-border-stronger);
  transform: translateY(-2px);
}

.integration-icon {
  font-size: 2.5rem;
}

.integration-name {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-muted);
}

.integration-status {
  font-size: 0.875rem;
  font-weight: 600;
  padding: 0.5rem 1rem;
  border-radius: 2rem;
  background: var(--color-control);
  color: var(--color-text-muted);
}

.integration-card.configured .integration-status {
  background: rgba(16, 185, 129, 0.1);
  color: var(--color-success);
}

.integration-card.failed .integration-status {
  background: rgba(248, 113, 113, 0.1);
  color: #f87171;
}

/* Activity Section */
.activity-section {
  margin-bottom: var(--space-2xl);
}

.activity-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.activity-item {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  padding: 1.25rem;
  background: linear-gradient(135deg, rgba(30, 41, 59, 0.8), rgba(15, 23, 42, 0.6));
  border: 1px solid var(--color-border);
  border-radius: 0.75rem;
  transition: all 0.3s ease;
  animation: slideUp 0.6s ease-out forwards;
}

.activity-item:nth-child(1) { animation-delay: 0.4s; }
.activity-item:nth-child(2) { animation-delay: 0.5s; }
.activity-item:nth-child(3) { animation-delay: 0.6s; }
.activity-item:nth-child(4) { animation-delay: 0.7s; }

.activity-item:hover {
  border-color: var(--color-border-stronger);
  background: linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(20, 30, 50, 0.8));
  transform: translateX(4px);
}

.activity-time {
  font-size: 0.875rem;
  color: var(--color-text-subtle);
  font-family: 'Space Mono', monospace;
  min-width: 70px;
  font-weight: 600;
}

.activity-content {
  flex: 1;
}

.activity-title {
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 0.25rem;
}

.activity-description {
  font-size: 0.875rem;
  color: var(--color-text-muted);
}

.activity-icon {
  font-size: 1.5rem;
  opacity: 0.6;
  min-width: 30px;
  text-align: center;
}

/* Responsive */
@media (max-width: 1024px) {
  .dashboard-content {
    padding: 2rem;
  }

  .stats-grid {
    grid-template-columns: 1fr;
    gap: var(--space-lg);
  }

  .dashboard-panels {
    grid-template-columns: 1fr;
  }

  .timer-value {
    font-size: 3rem;
  }
}

@media (max-width: 640px) {
  .page-header {
    flex-direction: column;
    gap: 1rem;
    padding: 1.5rem;
  }

  .header-content {
    flex-direction: column;
    gap: 1rem;
    width: 100%;
  }

  .dashboard-content {
    padding: 1.5rem;
  }

  .timer-controls {
    flex-direction: column;
  }

  .btn-control {
    width: 100%;
  }

  .activity-item {
    flex-wrap: wrap;
  }

  .panel-heading {
    flex-direction: column;
  }

  .submission-row {
    grid-template-columns: 1fr 1fr;
  }

  .submission-status {
    text-align: left;
    grid-column: 1 / -1;
  }
}
</style>
