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
    const date = parseDateKey(entry.date)
    return !!date && date >= start
  })
  return {
    count: pending.length,
    hours: (pending.reduce((sum, entry) => sum + entry.duration, 0) / 60).toFixed(1)
  }
})

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
}
</style>
