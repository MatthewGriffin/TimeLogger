<template>
  <div class="dashboard">
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
    <div class="dashboard-content">
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
          <div class="stat-icon">✅</div>
          <div class="stat-content">
            <div class="stat-label">Tasks Completed</div>
            <div class="stat-value">{{ tasksCompleted }}</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">📊</div>
          <div class="stat-content">
            <div class="stat-label">Missed Days</div>
            <div class="stat-value">{{ missedDaysCount }}</div>
          </div>
        </div>
      </div>

      <!-- Recent Activity -->
      <div class="activity-section">
        <h2 class="section-title">Recent Activity</h2>
        <div class="activity-list">
          <div class="activity-item" v-for="(item, idx) in recentActivity" :key="idx">
            <div class="activity-time">{{ formatActivityTime(item.timestamp) }}</div>
            <div class="activity-content">
              <div class="activity-title">{{ item.title }}</div>
              <div class="activity-description">{{ item.description }}</div>
            </div>
            <div class="activity-icon">{{ item.icon }}</div>
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
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useEntriesStore } from '../stores/entries'
import { useConfigStore } from '../stores/config'
import { useAppStore } from '../stores/app'
import ConfigurationStatus from '../components/ConfigurationStatus.vue'

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

// Sample data
const tasksCompleted = computed(() => entriesStore.entries.length)
const missedDaysCount = computed(() => entriesStore.missedDays.length)

const recentActivity = computed(() => {
  const entries = entriesStore.entries.slice(-5).reverse()
  return entries.map(entry => ({
    timestamp: new Date(entry.date).getTime(),
    title: entry.taskName,
    description: `${entry.duration} minutes logged`,
    icon: entry.submitted ? '✅' : '✓'
  }))
})

const todayHours = computed(() => entriesStore.getTodayHours)

// Update current time
const updateTime = () => {
  const now = new Date()
  currentTime.value = now.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: true 
  })
  
  currentDate.value = now.toLocaleDateString('en-US', { 
    weekday: 'short', 
    month: 'short', 
    day: 'numeric' 
  })
}

// Format activity time
const formatActivityTime = (timestamp: number) => {
  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  return new Date(timestamp).toLocaleDateString()
}

// Lifecycle
onMounted(async () => {
  updateTime()
  const timeInterval = setInterval(updateTime, 1000)
  
  try {
    await appStore.initializeApp()
  } catch (error) {
    console.error('Failed to load dashboard data:', error)
  }

  // Deliberately not awaited with the above: the count is a secondary stat and
  // should never hold up the dashboard rendering.
  entriesStore.loadMissedDays()
  
  onUnmounted(() => {
    clearInterval(timeInterval)
  })
})
</script>

<style scoped>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

.dashboard {
  min-height: 100vh;
  color: #e2e8f0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
  overflow-y: auto;
}

/* Page Header */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 2rem 3rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  background: rgba(15, 23, 42, 0.5);
  backdrop-filter: blur(10px);
  position: sticky;
  top: 0;
  z-index: 100;
}

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
  color: #06b6d4;
  letter-spacing: 0.05em;
}

.date-display {
  font-size: 0.875rem;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.quick-actions {
  display: flex;
  gap: 1rem;
}

.btn-link {
  padding: 0.75rem 1.5rem;
  background: linear-gradient(135deg, #06b6d4, #0891b2);
  color: #0f172a;
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
  box-shadow: 0 8px 16px rgba(6, 182, 212, 0.3);
}

/* Content */
.dashboard-content {
  padding: 3rem;
  max-width: 1400px;
  margin: 0 auto;
}

/* Stats Grid */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 2rem;
  margin-bottom: 3rem;
}

.stat-card {
  display: flex;
  gap: 1.5rem;
  padding: 1.5rem;
  background: linear-gradient(135deg, rgba(30, 41, 59, 0.8), rgba(15, 23, 42, 0.6));
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 0.75rem;
  backdrop-filter: blur(10px);
  transition: all 0.3s ease;
  animation: slideUp 0.6s ease-out forwards;
}

.stat-card:nth-child(1) { animation-delay: 0s; }
.stat-card:nth-child(2) { animation-delay: 0.1s; }
.stat-card:nth-child(3) { animation-delay: 0.2s; }

.stat-card:hover {
  border-color: rgba(148, 163, 184, 0.3);
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
  background: rgba(6, 182, 212, 0.1);
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
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
}

.stat-value {
  font-size: 2rem;
  font-weight: 700;
  font-family: 'Space Mono', monospace;
  color: #06b6d4;
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
  margin-bottom: 3rem;
}

.section-title {
  font-size: 1.3rem;
  font-weight: 700;
  margin-bottom: 1.5rem;
  letter-spacing: -0.3px;
  padding-bottom: 1rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
}

.integrations-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1.5rem;
}

.integration-card {
  padding: 1.5rem;
  background: linear-gradient(135deg, rgba(30, 41, 59, 0.8), rgba(15, 23, 42, 0.6));
  border: 1px solid rgba(148, 163, 184, 0.1);
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
  border-color: rgba(148, 163, 184, 0.3);
  transform: translateY(-2px);
}

.integration-icon {
  font-size: 2.5rem;
}

.integration-name {
  font-size: 1rem;
  font-weight: 600;
  color: #cbd5e1;
}

.integration-status {
  font-size: 0.875rem;
  font-weight: 600;
  padding: 0.5rem 1rem;
  border-radius: 2rem;
  background: rgba(51, 65, 85, 0.5);
  color: #cbd5e1;
}

.integration-card.configured .integration-status {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
}

.integration-card.failed .integration-status {
  background: rgba(248, 113, 113, 0.1);
  color: #f87171;
}

/* Activity Section */
.activity-section {
  margin-bottom: 3rem;
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
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 0.75rem;
  transition: all 0.3s ease;
  animation: slideUp 0.6s ease-out forwards;
}

.activity-item:nth-child(1) { animation-delay: 0.4s; }
.activity-item:nth-child(2) { animation-delay: 0.5s; }
.activity-item:nth-child(3) { animation-delay: 0.6s; }
.activity-item:nth-child(4) { animation-delay: 0.7s; }

.activity-item:hover {
  border-color: rgba(148, 163, 184, 0.3);
  background: linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(20, 30, 50, 0.8));
  transform: translateX(4px);
}

.activity-time {
  font-size: 0.875rem;
  color: #94a3b8;
  font-family: 'Space Mono', monospace;
  min-width: 70px;
  font-weight: 600;
}

.activity-content {
  flex: 1;
}

.activity-title {
  font-weight: 600;
  color: #e2e8f0;
  margin-bottom: 0.25rem;
}

.activity-description {
  font-size: 0.875rem;
  color: #cbd5e1;
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
    gap: 1.5rem;
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
