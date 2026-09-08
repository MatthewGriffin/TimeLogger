<template>
  <div class="daily-entries">
    <!-- Page Header -->
    <div class="page-header">
      <h1>Daily Entries</h1>
      <div class="header-actions">
        <button class="btn-today" @click="goToToday" :disabled="entriesStore.isLoading">Today</button>
        <button class="btn-nav" @click="previousDay" :disabled="entriesStore.isLoading">← Previous</button>
        <div class="date-display">{{ formatDateHeader(selectedDate) }}</div>
        <button class="btn-nav" @click="nextDay" :disabled="entriesStore.isLoading">Next →</button>
        <button class="btn-sync" :disabled="entriesStore.isSyncingCalendar" @click="syncCalendarToEntries">
          {{ entriesStore.isSyncingCalendar ? 'Syncing…' : '🔄 Sync Meetings' }}
        </button>
      </div>
    </div>

    <!-- Main content -->
    <div class="entries-content">
      <MeetingConflictReview :date="selectedDate" />

      <!-- Loading indicator -->
      <div v-if="entriesStore.isLoading" class="loading-container">
        <div class="spinner"></div>
        <p>Loading entries...</p>
      </div>

      <!-- Error message -->
      <!-- Entries Table -->
      <div class="entries-section">
        <div class="section-header">
          <h2>Time Entries</h2>
          <div class="total-hours">Total: {{ totalHours }} hours</div>
        </div>

        <div v-if="entriesByDate.length > 0" class="entries-table">
          <div class="table-header">
            <div class="col-task">Task</div>
            <div class="col-ticket">Ticket</div>
            <div class="col-time">Start</div>
            <div class="col-time">End</div>
            <div class="col-duration">Duration</div>
            <div class="col-actions">Actions</div>
          </div>
          <div class="table-body">
            <div v-for="entry in entriesByDate" :key="entry.id" class="table-row">
              <div class="col-task">{{ entry.taskName }}</div>
              <div class="col-ticket">{{ entry.ticketId || '-' }}</div>
              <div class="col-time">{{ formatTime(entry.startTime) }}</div>
              <div class="col-time">{{ formatTime(entry.endTime) }}</div>
              <div class="col-duration">{{ formatDuration(entry.duration) }}</div>
              <div class="col-actions">
                <button class="btn-icon" @click="editEntry(entry)" title="Edit">✏️</button>
                <button 
                  class="btn-icon delete" 
                  @click="deleteEntry(entry.id)" 
                  title="Delete"
                  :disabled="entriesStore.isLoading"
                >🗑️</button>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="empty-state">
          <div class="empty-icon">📭</div>
          <p>No entries for this date</p>
        </div>
      </div>

      <!-- Quick Add Form -->
      <div class="add-section">
        <h2>Add Entry</h2>
        <form @submit.prevent="submitEntry" class="entry-form">
          <div class="form-group">
            <label>Task Name *</label>
            <div class="input-with-button">
              <input 
                v-model="newEntry.taskName" 
                type="text" 
                placeholder="e.g., Implement login form" 
                required 
                ref="taskNameInput"
                :disabled="entriesStore.isLoading"
              />
              <button
                v-if="configStore.isJiraConfigured()"
                type="button"
                class="btn-ai btn-ai-inline"
                @click="findJiraTicket('add')"
                :disabled="jiraStore.isSearching"
                title="Look up the Jira ticket for this task name"
              >
                {{ jiraStore.isSearching ? '⏳' : '🔍' }}
              </button>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>Start Time *</label>
              <input 
                v-model="newEntry.startTime" 
                type="time" 
                required 
                :disabled="entriesStore.isLoading"
              />
            </div>
            <div class="form-group">
              <label>End Time *</label>
              <input 
                v-model="newEntry.endTime" 
                type="time" 
                required 
                :disabled="entriesStore.isLoading"
              />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>Ticket ID</label>
              <input 
                v-model="newEntry.ticketId" 
                type="text" 
                placeholder="e.g., PROJ-123"
                list="recent-tickets"
                :disabled="entriesStore.isLoading"
              />
              <datalist id="recent-tickets">
                <option v-for="ticket in recentTickets" :key="ticket" :value="ticket" />
              </datalist>
            </div>
            <div class="form-group">
              <label>Duration (calc)</label>
              <input type="text" :value="calculatedDuration" disabled />
            </div>
          </div>

          <button 
            type="submit" 
            class="btn-submit"
            :disabled="entriesStore.isLoading"
          >
            {{ entriesStore.isLoading ? 'Adding...' : 'Add Entry' }}
          </button>
        </form>
      </div>
    </div>

    <!-- Edit Modal -->
    <div v-if="editingEntry" class="modal-overlay" @click.self="cancelEdit">
      <div class="modal">
        <div class="modal-header">
          <h2>Edit Entry</h2>
          <button class="modal-close" @click="cancelEdit" :disabled="entriesStore.isLoading">✕</button>
        </div>
        <form @submit.prevent="submitEditEntry" class="entry-form">
          <div class="form-group">
            <label>Task Name *</label>
            <div class="input-with-button">
              <input 
                v-model="editingEntry.taskName" 
                type="text" 
                required 
                :disabled="entriesStore.isLoading"
              />
              <button
                v-if="configStore.isJiraConfigured()"
                type="button"
                class="btn-ai btn-ai-inline"
                @click="findJiraTicket('edit')"
                :disabled="jiraStore.isSearching"
                title="Look up the Jira ticket for this task name"
              >
                {{ jiraStore.isSearching ? '⏳' : '🔍' }}
              </button>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>Start Time *</label>
              <input 
                v-model="editingEntry.startTime" 
                type="time" 
                required 
                :disabled="entriesStore.isLoading"
              />
            </div>
            <div class="form-group">
              <label>End Time *</label>
              <input 
                v-model="editingEntry.endTime" 
                type="time" 
                required 
                :disabled="entriesStore.isLoading"
              />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>Ticket ID</label>
              <input 
                v-model="editingEntry.ticketId" 
                type="text" 
                :disabled="entriesStore.isLoading"
              />
            </div>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn-secondary" @click="cancelEdit" :disabled="entriesStore.isLoading">Cancel</button>
            <button type="submit" class="btn-primary" :disabled="entriesStore.isLoading">
              {{ entriesStore.isLoading ? 'Saving...' : 'Save Changes' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Jira Ticket Lookup Modal -->
    <div v-if="showTicketLookup" class="modal-overlay" @click.self="closeTicketLookup">
      <div class="modal ai-modal">
        <div class="modal-header">
          <h2>🔍 Jira Ticket Lookup</h2>
          <button class="modal-close" @click="closeTicketLookup">✕</button>
        </div>
        <div class="modal-content">
          <div class="suggestion-item">
            <label class="suggestion-label">Searched For:</label>
            <div class="suggestion-preview">{{ jiraStore.lastQuery }}</div>
          </div>

          <div class="suggestion-item">
            <label class="suggestion-label">Your Matching Tickets:</label>
            <button
              v-for="match in jiraStore.matches"
              :key="match.key"
              type="button"
              class="ticket-match"
              @click="acceptTicket(match)"
            >
              <span class="ticket-match-key">{{ match.key }}</span>
              <span class="ticket-match-summary">{{ match.summary }}</span>
              <span v-if="match.status" class="ticket-match-status">{{ match.status }}</span>
            </button>
          </div>

          <div class="ai-info">
            <span>ℹ️</span>
            <p>Only tickets assigned to you, reported by you, or recently updated by you are searched.</p>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" @click="closeTicketLookup">Close</button>
        </div>
      </div>
    </div>

    <MeetingTicketPrompt :meetings="unmappedMeetings" @close="onPromptClose" />
    <MeetingConflictPrompt />
    <LunchConflictPrompt />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useEntriesStore } from '../stores/entries'
import type { TimeEntry } from '../stores/entries'
import { useUiStore } from '../stores/ui'
import { useConfigStore } from '../stores/config'
import { useJiraStore } from '../stores/jira'
import type { JiraMatch } from '../stores/jira'
import type { UnmappedMeeting } from '../stores/entries'
import MeetingTicketPrompt from '../components/MeetingTicketPrompt.vue'
import MeetingConflictPrompt from '../components/MeetingConflictPrompt.vue'
import MeetingConflictReview from '../components/MeetingConflictReview.vue'
import LunchConflictPrompt from '../components/LunchConflictPrompt.vue'
import { localDate } from '../utils/dates'

const unmappedMeetings = ref<UnmappedMeeting[]>([])

const entriesStore = useEntriesStore()
const uiStore = useUiStore()
const configStore = useConfigStore()
const jiraStore = useJiraStore()

const selectedDate = computed({
  get: () => entriesStore.selectedDate,
  set: (value: string) => { entriesStore.selectedDate = value }
})
const editingEntry = ref<TimeEntry | null>(null)
const taskNameInput = ref<HTMLInputElement | null>(null)

const showTicketLookup = ref(false)

const newEntry = ref({
  taskName: '',
  ticketId: '',
  startTime: '',
  endTime: ''
})

const recentTickets = computed(() => {
  const tickets = new Set<string>()
  const entries = Array.isArray(entriesStore.entries) ? entriesStore.entries : []
  entries.forEach(entry => {
    if (entry.ticketId) tickets.add(entry.ticketId)
  })
  // Also include from loaded issues
  const issues = Array.isArray(entriesStore.recentIssues) ? entriesStore.recentIssues : []
  issues.forEach(issue => {
    tickets.add(issue.key)
  })
  return Array.from(tickets).slice(0, 10)
})

const entriesByDate = computed(() => {
  return entriesStore.getEntriesByDate(selectedDate.value)
})

const totalHours = computed(() => {
  const minutes = entriesByDate.value.reduce((sum, e) => sum + (Number(e.duration) || 0), 0)
  return (minutes / 60).toFixed(2)
})

const calculatedDuration = computed(() => {
  if (!newEntry.value.startTime || !newEntry.value.endTime) return '-'
  const [startHour, startMin] = newEntry.value.startTime.split(':').map(Number)
  const [endHour, endMin] = newEntry.value.endTime.split(':').map(Number)
  const startMins = startHour * 60 + startMin
  const endMins = endHour * 60 + endMin
  const duration = endMins - startMins
  if (duration < 0) return 'Invalid'
  const hours = Math.floor(duration / 60)
  const mins = duration % 60
  return `${hours}h ${mins}m`
})

const formatTime = (time: string) => {
  if (!time) return '-'
  const [hours, minutes] = time.split(':')
  return `${hours}:${minutes}`
}

const formatDuration = (minutes: number) => {
  const total = Number(minutes) || 0
  const hours = Math.floor(total / 60)
  const mins = total % 60
  return `${hours}h ${mins}m`
}

const formatDateHeader = (date: string) => {
  return parseDate(date).toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}

// Parsed as local noon: 'YYYY-MM-DD' alone is read as UTC midnight, which lands
// on the previous day in any negative-offset timezone.
const parseDate = (value: string) => new Date(`${value}T12:00:00`)

const goToToday = async () => {
  selectedDate.value = localDate(new Date())
  await loadEntriesForDate(selectedDate.value)
}

const syncCalendarToEntries = async () => {
  const result = await entriesStore.syncCalendar(selectedDate.value)
  if (!result) {
    uiStore.showError(entriesStore.calendarSyncMessage || 'Calendar sync failed')
    return
  }
  await loadEntriesForDate(selectedDate.value)
  if (result.clashed && result.clashed > 0) uiStore.showInfo(result.message)
  else if (result.created > 0) uiStore.showSuccess(result.message)
  else uiStore.showInfo(result.message)

  // Meetings that matched no keyword have no ticket, so ask rather than
  // leaving them silently unsubmittable.
  entriesStore.clearPendingUnmapped()
  unmappedMeetings.value = await entriesStore.loadUnticketedMeetings(selectedDate.value)
}

const onPromptClose = async (assignedCount: number) => {
  unmappedMeetings.value = []
  if (assignedCount > 0) {
    await loadEntriesForDate(selectedDate.value)
    uiStore.showSuccess(`Assigned tickets to ${assignedCount} meeting(s)`)
  }
}

const previousDay = async () => {
  const date = parseDate(selectedDate.value)
  date.setDate(date.getDate() - 1)
  selectedDate.value = localDate(date)
  await loadEntriesForDate(selectedDate.value)
}

const nextDay = async () => {
  const date = parseDate(selectedDate.value)
  date.setDate(date.getDate() + 1)
  selectedDate.value = localDate(date)
  await loadEntriesForDate(selectedDate.value)
}

const loadEntriesForDate = async (date: string) => {
  try {
    await entriesStore.loadEntries(date)
    await runAutoSync(date)
  } catch (error) {
    console.error('Daily entries fallback:', error)
  }
}

/**
 * Fill an untouched day from the calendar, then ask about anything that could
 * not be matched to a ticket. Unmapped meetings are raised here rather than
 * suppressed, because a ticketless entry never reaches Tempo.
 */
const runAutoSync = async (date: string) => {
  const result = await entriesStore.autoSyncCalendarIfEmpty(date)
  if (result && result.created > 0) uiStore.showInfo(result.message)
  entriesStore.clearPendingUnmapped()
  // Read from the day itself rather than the sync result, so a meeting skipped
  // on an earlier visit is offered again instead of being stranded.
  unmappedMeetings.value = await entriesStore.loadUnticketedMeetings(date)
}

const submitEntry = async () => {
  if (!newEntry.value.startTime || !newEntry.value.endTime || !newEntry.value.taskName) {
    uiStore.showError('Please fill in all required fields')
    return
  }

  const [startHour, startMin] = newEntry.value.startTime.split(':').map(Number)
  const [endHour, endMin] = newEntry.value.endTime.split(':').map(Number)
  const startMins = startHour * 60 + startMin
  const endMins = endHour * 60 + endMin
  const duration = endMins - startMins

  if (duration <= 0) {
    uiStore.showError('End time must be after start time')
    return
  }

  try {
    await entriesStore.addEntry({
      date: selectedDate.value,
      taskName: newEntry.value.taskName,
      ticketId: newEntry.value.ticketId || undefined,
      startTime: newEntry.value.startTime,
      endTime: newEntry.value.endTime,
      duration
    })

    newEntry.value = { taskName: '', ticketId: '', startTime: '', endTime: '' }
    uiStore.showSuccess('Entry added successfully')
  } catch (error) {
    uiStore.showError(entriesStore.error || 'Failed to add entry')
  }
}

const editEntry = (entry: TimeEntry) => {
  editingEntry.value = { ...entry }
}

const submitEditEntry = async () => {
  if (!editingEntry.value) return

  const [startHour, startMin] = editingEntry.value.startTime.split(':').map(Number)
  const [endHour, endMin] = editingEntry.value.endTime.split(':').map(Number)
  const startMins = startHour * 60 + startMin
  const endMins = endHour * 60 + endMin
  const duration = endMins - startMins

  if (duration <= 0) {
    uiStore.showError('End time must be after start time')
    return
  }

  try {
    await entriesStore.updateEntry(editingEntry.value.id, {
      taskName: editingEntry.value.taskName,
      ticketId: editingEntry.value.ticketId,
      startTime: editingEntry.value.startTime,
      endTime: editingEntry.value.endTime,
      duration
    })
    editingEntry.value = null
    uiStore.showSuccess('Entry updated successfully')
  } catch {
    uiStore.showError(entriesStore.error || 'Failed to update entry')
  }
}

const cancelEdit = () => {
  editingEntry.value = null
}

const deleteEntry = async (id: string) => {
  try {
    await entriesStore.deleteEntry(id)
    uiStore.showSuccess('Entry deleted successfully')
  } catch {
    uiStore.showError(entriesStore.error || 'Failed to delete entry')
  }
}

// Jira ticket lookup
const ticketLookupTarget = ref<'add' | 'edit'>('add')

const findJiraTicket = async (target: 'add' | 'edit' = 'add') => {
  const form = target === 'edit' ? editingEntry.value : newEntry.value
  if (!form) return

  const query = form.taskName.trim() || (form.ticketId ?? '').trim()

  if (!query) {
    uiStore.showError('Enter a task name or ticket ID to search for')
    return
  }

  ticketLookupTarget.value = target

  try {
    const matches = await jiraStore.findTicket(query)
    if (matches.length === 0) {
      uiStore.showInfo(jiraStore.error || `No Jira tickets found for "${query}"`)
      return
    }

    // A single confident match needs no disambiguation.
    if (matches.length === 1 && matches[0].confidence >= 0.9) {
      acceptTicket(matches[0])
      return
    }

    showTicketLookup.value = true
  } catch (error) {
    uiStore.reportError(error, 'Failed to search Jira')
  }
}

const acceptTicket = (match: JiraMatch) => {
  const form = ticketLookupTarget.value === 'edit' ? editingEntry.value : newEntry.value
  if (!form) return

  form.ticketId = match.key
  if (match.summary) {
    form.taskName = match.summary
  }
  showTicketLookup.value = false
  uiStore.showSuccess(`Ticket set to ${match.key}`)
}

const closeTicketLookup = () => {
  showTicketLookup.value = false
  jiraStore.clear()
}

onMounted(async () => {
  try {
    // Load entries for selected date
    await entriesStore.loadEntries(selectedDate.value)
    // Load recent issues for ticket dropdown
    await entriesStore.loadRecentIssues()
    // A day with nothing from the calendar is pulled in on first view.
    await runAutoSync(selectedDate.value)
  } catch (error) {
    console.error('Failed to load initial data:', error)
  }
})

// Lets the tray menu's "Add Task" item jump straight to this field, even if
// the page was already open (App.vue dispatches this after navigating here).
const onFocusRequest = (event: Event) => {
  if ((event as CustomEvent<string>).detail !== 'task') return
  nextTick(() => taskNameInput.value?.focus())
}

window.addEventListener('timelogger:focus-request', onFocusRequest)
onUnmounted(() => window.removeEventListener('timelogger:focus-request', onFocusRequest))
</script>

<style scoped>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

.daily-entries {
  min-height: 100vh;
  color: #e2e8f0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
  overflow-y: auto;
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
  margin-bottom: 1.5rem;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.date-display {
  font-size: 1.1rem;
  color: #06b6d4;
  font-weight: 600;
  min-width: 200px;
  text-align: center;
}

.btn-sync {
  padding: 0.5rem 1rem;
  background: rgba(16, 185, 129, 0.15);
  border: 1px solid #10b981;
  color: #34d399;
  border-radius: 0.5rem;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.3s ease;
  font-size: 0.9rem;
}

.btn-sync:hover:not(:disabled) {
  background: rgba(16, 185, 129, 0.3);
}

.btn-sync:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-today,
.btn-nav {
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

.btn-today:hover,
.btn-nav:hover {
  background: rgba(51, 65, 85, 0.8);
  border-color: rgba(148, 163, 184, 0.4);
}

.btn-today:disabled,
.btn-nav:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-today {
  background: rgba(6, 182, 212, 0.2);
  border-color: #06b6d4;
  color: #06b6d4;
}

/* Loading and Error States */
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4rem 2rem;
  gap: 1rem;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid rgba(6, 182, 212, 0.2);
  border-top-color: #06b6d4;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-message {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.5rem;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 0.5rem;
  margin: 2rem 3rem;
  color: #fca5a5;
}

.error-icon {
  font-size: 1.5rem;
}

/* Content */
.entries-content {
  padding: 3rem;
  max-width: 1400px;
  margin: 0 auto;
}

/* Entries Section */
.entries-section {
  margin-bottom: 3rem;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
}

.section-header h2 {
  font-size: 1.3rem;
  font-weight: 700;
}

.total-hours {
  font-size: 1.1rem;
  color: #06b6d4;
  font-weight: 600;
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
  grid-template-columns: 2fr 1fr 1fr 1fr 1fr 1fr;
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
  display: flex;
  flex-direction: column;
}

.table-row {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1fr 1fr 1fr;
  gap: 1rem;
  padding: 1rem 1.5rem;
  align-items: center;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  transition: background 0.3s ease;
}

.table-row:hover {
  background: rgba(51, 65, 85, 0.3);
}

.col-task {
  font-weight: 500;
  color: #e2e8f0;
}

.col-ticket {
  color: #cbd5e1;
  font-family: 'Space Mono', monospace;
  font-size: 0.9rem;
}

.col-time {
  color: #cbd5e1;
  font-family: 'Space Mono', monospace;
  text-align: center;
}

.col-duration {
  color: #06b6d4;
  font-weight: 600;
  text-align: center;
}

.col-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}

.btn-icon {
  background: none;
  border: none;
  color: #06b6d4;
  font-size: 1.2rem;
  cursor: pointer;
  transition: all 0.3s ease;
  padding: 0.25rem;
}

.btn-icon:hover:not(:disabled) {
  transform: scale(1.2);
  color: #0891b2;
}

.btn-icon:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-icon.delete:hover:not(:disabled) {
  color: #ef4444;
}

/* Empty State */
.empty-state {
  text-align: center;
  padding: 3rem;
  color: #94a3b8;
}

.empty-icon {
  font-size: 3rem;
  margin-bottom: 1rem;
}

/* Add Section */
.add-section {
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 0.75rem;
  padding: 2rem;
  backdrop-filter: blur(10px);
}

.add-section h2 {
  font-size: 1.3rem;
  font-weight: 700;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
}

/* Form */
.entry-form {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group label {
  font-weight: 600;
  font-size: 0.9rem;
  color: #cbd5e1;
}

.form-group input {
  padding: 0.75rem;
  background: rgba(51, 65, 85, 0.5);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.5rem;
  color: #e2e8f0;
  font-size: 0.95rem;
  transition: all 0.3s ease;
}

.form-group input:focus {
  outline: none;
  border-color: #06b6d4;
  background: rgba(51, 65, 85, 0.8);
}

.form-group input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
}

.btn-submit {
  padding: 0.75rem 2rem;
  background: linear-gradient(135deg, #06b6d4, #0891b2);
  color: #0f172a;
  border: none;
  border-radius: 0.5rem;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.3s ease;
  font-size: 0.95rem;
  align-self: flex-start;
}

.btn-submit:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 8px 16px rgba(6, 182, 212, 0.3);
}

.btn-submit:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: linear-gradient(135deg, #0f172a, #1a1f3a);
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 1rem;
  padding: 2rem;
  max-width: 500px;
  width: 90%;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
}

.modal-header h2 {
  font-size: 1.3rem;
  font-weight: 700;
}

.modal-close {
  background: none;
  border: none;
  color: #cbd5e1;
  font-size: 1.5rem;
  cursor: pointer;
  transition: color 0.3s ease;
}

.modal-close:hover:not(:disabled) {
  color: #e2e8f0;
}

.modal-close:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.modal-footer {
  display: flex;
  gap: 1rem;
  justify-content: flex-end;
  margin-top: 2rem;
  padding-top: 1rem;
  border-top: 1px solid rgba(148, 163, 184, 0.1);
}

.btn-primary {
  padding: 0.75rem 1.5rem;
  background: linear-gradient(135deg, #06b6d4, #0891b2);
  color: #0f172a;
  border: none;
  border-radius: 0.5rem;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.3s ease;
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-2px);
}

.btn-primary:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.btn-secondary {
  padding: 0.75rem 1.5rem;
  background: rgba(51, 65, 85, 0.5);
  border: 1px solid rgba(148, 163, 184, 0.2);
  color: #cbd5e1;
  border-radius: 0.5rem;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.3s ease;
}

.btn-secondary:hover:not(:disabled) {
  background: rgba(51, 65, 85, 0.8);
}

.btn-secondary:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

/* AI Features */
.form-label-with-button {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
}

.input-with-button {
  position: relative;
  display: flex;
}

.input-with-button input {
  flex: 1;
  /* Room for the search button so typed text never runs under it. */
  padding-right: 2.75rem;
}

.btn-ai {
  background: rgba(6, 182, 212, 0.2);
  border: 1px solid rgba(6, 182, 212, 0.4);
  color: #06b6d4;
  padding: 0.5rem 0.75rem;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 1rem;
  font-weight: 600;
  transition: all 0.3s ease;
  white-space: nowrap;
}

.btn-ai-inline {
  position: absolute;
  right: 0.4rem;
  top: 50%;
  transform: translateY(-50%);
  padding: 0.35rem 0.55rem;
}

.btn-ai:hover:not(:disabled) {
  background: rgba(6, 182, 212, 0.3);
  border-color: #06b6d4;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(6, 182, 212, 0.2);
}

/* Overrides the lift from .btn-ai:hover above (same specificity, so ordering
   alone isn't reliable) — this button is absolutely centered via
   translateY(-50%), and any extra vertical movement on hover breaks that
   centering and visibly drops it toward the bottom of the input. */
.input-with-button .btn-ai-inline:hover:not(:disabled) {
  transform: translateY(-50%);
  box-shadow: none;
}

.btn-ai:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* AI Suggestion Modal */
.ai-modal {
  max-width: 600px;
}

.modal-content {
  padding: 1.5rem 0;
}

.suggestion-item {
  margin-bottom: 1.5rem;
}

.suggestion-label {
  display: block;
  font-weight: 600;
  font-size: 0.9rem;
  color: #cbd5e1;
  margin-bottom: 0.5rem;
}

.suggestion-preview {
  padding: 1rem;
  background: rgba(51, 65, 85, 0.5);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.5rem;
  color: #cbd5e1;
  font-size: 0.95rem;
  word-break: break-word;
  max-height: 100px;
  overflow-y: auto;
}

.suggestion-highlight {
  padding: 1rem;
  background: rgba(6, 182, 212, 0.1);
  border: 2px solid rgba(6, 182, 212, 0.3);
  border-radius: 0.5rem;
  color: #06b6d4;
  font-size: 1rem;
  font-weight: 600;
  word-break: break-word;
}

.ticket-match {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  width: 100%;
  padding: 0.75rem 1rem;
  margin-bottom: 0.5rem;
  background: rgba(51, 65, 85, 0.5);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.5rem;
  color: #cbd5e1;
  font-size: 0.95rem;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.ticket-match:hover,
.ticket-match:focus-visible {
  background: rgba(6, 182, 212, 0.12);
  border-color: rgba(6, 182, 212, 0.45);
}

.ticket-match-key {
  flex-shrink: 0;
  color: #06b6d4;
  font-weight: 600;
}

.ticket-match-summary {
  flex: 1;
  word-break: break-word;
}

.ticket-match-status {
  flex-shrink: 0;
  color: #94a3b8;
  font-size: 0.8rem;
}

.ai-info {
  display: flex;
  gap: 0.75rem;
  padding: 1rem;
  background: rgba(6, 182, 212, 0.1);
  border-left: 3px solid #06b6d4;
  border-radius: 0.375rem;
  margin-top: 1rem;
}

.ai-info span {
  font-size: 1.2rem;
  flex-shrink: 0;
}

.ai-info p {
  margin: 0;
  color: #cbd5e1;
  font-size: 0.9rem;
  line-height: 1.4;
}

/* Responsive */
@media (max-width: 1024px) {
  .entries-content {
    padding: 2rem;
  }

  .table-header,
  .table-row {
    grid-template-columns: 1fr 1fr;
  }

  .col-ticket {
    display: none;
  }

  .form-row {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .page-header {
    padding: 1.5rem;
  }

  .header-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .date-display {
    min-width: auto;
  }

  .entries-content {
    padding: 1.5rem;
  }

  .table-header,
  .table-row {
    grid-template-columns: 1fr;
    gap: 0.5rem;
  }
}
</style>
