<template>
  <div class="calendar-page">
    <!-- Page Header -->
    <div class="page-header">
      <div class="header-content">
        <h1>Calendar</h1>
        <div class="month-display">{{ currentMonthYear }}</div>
      </div>
      <div class="header-actions">
        <button class="btn-nav" @click="previousMonth">← Previous</button>
        <button class="btn-today" @click="goToToday">Today</button>
        <button class="btn-nav" @click="nextMonth">Next →</button>
        <button class="btn-sync" :disabled="entriesStore.isSyncingCalendar" @click="syncCalendarToEntries">
          {{ entriesStore.isSyncingCalendar ? 'Syncing…' : '🔄 Sync Meetings' }}
        </button>
      </div>
    </div>

    <!-- Calendar View -->
    <div class="calendar-content">
      <div class="calendar-container">
        <!-- Days of week header -->
        <div class="calendar-weekdays">
          <div v-for="day in weekDays" :key="day" class="weekday">{{ day }}</div>
        </div>

        <!-- Calendar days -->
        <div class="calendar-grid">
          <div
            v-for="day in calendarDays"
            :key="day.date"
            :class="['calendar-day', { 'other-month': !day.isCurrentMonth, 'today': day.isToday, 'selected': day.date === selectedDate, 'has-events': day.events.length > 0 }]"
            @click="selectedDate = day.date"
          >
            <div class="day-number">{{ day.dayOfMonth }}</div>
            <div class="day-events">
              <div
                v-for="event in day.events.slice(0, 2)"
                :key="event.id"
                :class="['event-badge', `priority-${event.priority || 'normal'}`]"
                :title="event.title"
              >
                {{ event.title.substring(0, 12) }}
              </div>
              <div v-if="day.events.length > 2" class="event-more">
                +{{ day.events.length - 2 }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Events List Sidebar -->
      <div class="calendar-sidebar">
        <h2>Events for {{ selectedDateDisplay }}</h2>
        
        <div v-if="selectedDayEvents.length > 0" class="events-list">
          <div
            v-for="event in selectedDayEvents"
            :key="event.id"
            :class="['event-item', `priority-${event.priority || 'normal'}`]"
          >
            <div class="event-time">
              {{ formatTime(event.startTime) }} - {{ formatTime(event.endTime) }}
            </div>
            <div class="event-content">
              <h3>{{ event.title }}</h3>
              <p v-if="event.description" class="event-description">{{ event.description }}</p>
              <div class="event-meta">
                <span v-if="event.duration" class="event-duration">⏱️ {{ event.duration }} min</span>
                <span v-if="event.location" class="event-location">📍 {{ event.location }}</span>
              </div>
            </div>
            <button class="btn-add-entry" @click="createEntryFromEvent(event)" title="Add as time entry">
              📝
            </button>
          </div>
        </div>

        <div v-else class="empty-state">
          <div class="empty-icon">📅</div>
          <p>No events on this date</p>
        </div>
      </div>
    </div>

    <!-- Event Modal -->
    <div v-if="selectedEvent" class="modal-overlay" @click.self="selectedEvent = null">
      <div class="modal">
        <div class="modal-header">
          <h2>{{ selectedEvent.title }}</h2>
          <button class="modal-close" @click="selectedEvent = null">✕</button>
        </div>

        <div class="event-details">
          <div class="detail-row">
            <span class="label">Time:</span>
            <span class="value">{{ formatTime(selectedEvent.startTime) }} - {{ formatTime(selectedEvent.endTime) }}</span>
          </div>
          <div class="detail-row">
            <span class="label">Duration:</span>
            <span class="value">{{ selectedEvent.duration }} minutes</span>
          </div>
          <div v-if="selectedEvent.location" class="detail-row">
            <span class="label">Location:</span>
            <span class="value">{{ selectedEvent.location }}</span>
          </div>
          <div v-if="selectedEvent.attendees" class="detail-row">
            <span class="label">Attendees:</span>
            <span class="value">{{ selectedEvent.attendees }}</span>
          </div>
          <div v-if="selectedEvent.description" class="detail-row full-width">
            <span class="label">Description:</span>
            <span class="value">{{ selectedEvent.description }}</span>
          </div>

          <button class="btn-add-entry full-width" @click="createEntryFromEvent(selectedEvent)">
            📝 Create Time Entry
          </button>
        </div>
      </div>
    </div>

    <MeetingTicketPrompt :meetings="unmappedMeetings" @close="onPromptClose" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useEntriesStore } from '../stores/entries'
import { useUiStore } from '../stores/ui'
import { executeApi, asList } from '../utils/api'
import type { UnmappedMeeting } from '../stores/entries'
import MeetingTicketPrompt from '../components/MeetingTicketPrompt.vue'

const unmappedMeetings = ref<UnmappedMeeting[]>([])

interface CalendarEvent {
  id: string
  date: string
  title: string
  startTime: string
  endTime: string
  duration: number
  location?: string
  description?: string
  attendees?: string
  isAllDay?: boolean
  priority?: 'high' | 'normal' | 'low'
}

interface CalendarDay {
  date: string
  dayOfMonth: number
  isCurrentMonth: boolean
  isToday: boolean
  events: CalendarEvent[]
}

const entriesStore = useEntriesStore()
const uiStore = useUiStore()

const currentDate = ref(new Date())
// The calendar works in local dates throughout; toISOString() would shift the
// day for any timezone east/west of UTC.
const toLocalDateString = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
const selectedDate = ref(toLocalDateString(new Date()))
const selectedEvent = ref<CalendarEvent | null>(null)
const calendarEvents = ref<CalendarEvent[]>([])
const isLoadingEvents = ref(false)

const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const currentMonthYear = computed(() => {
  return currentDate.value.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long'
  })
})

const selectedDateDisplay = computed(() => {
  return new Date(`${selectedDate.value}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
})

const calendarDays = computed(() => {
  const year = currentDate.value.getFullYear()
  const month = currentDate.value.getMonth()
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const daysInMonth = lastDay.getDate()
  const startingDayOfWeek = firstDay.getDay()

  const days: CalendarDay[] = []

  // Previous month days
  const prevMonthLastDay = new Date(year, month, 0).getDate()
  for (let i = startingDayOfWeek - 1; i >= 0; i--) {
    const date = new Date(year, month - 1, prevMonthLastDay - i)
    days.push({
      date: toLocalDateString(date),
      dayOfMonth: prevMonthLastDay - i,
      isCurrentMonth: false,
      isToday: false,
      events: getEventsForDate(date)
    })
  }

  // Current month days
  const today = toLocalDateString(new Date())
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day)
    const dateStr = toLocalDateString(date)
    days.push({
      date: dateStr,
      dayOfMonth: day,
      isCurrentMonth: true,
      isToday: dateStr === today,
      events: getEventsForDate(date)
    })
  }

  // Next month days
  const remainingDays = 42 - days.length
  for (let day = 1; day <= remainingDays; day++) {
    const date = new Date(year, month + 1, day)
    days.push({
      date: toLocalDateString(date),
      dayOfMonth: day,
      isCurrentMonth: false,
      isToday: false,
      events: getEventsForDate(date)
    })
  }

  return days
})

const selectedDayEvents = computed(() => {
  return calendarEvents.value.filter(event => event.date === selectedDate.value)
})

const getEventsForDate = (date: Date): CalendarEvent[] => {
  const dateStr = toLocalDateString(date)
  return calendarEvents.value.filter(event => event.date === dateStr)
}

/** Month currently shown in the grid, as YYYY-MM. */
const currentMonthKey = computed(() => {
  const year = currentDate.value.getFullYear()
  const month = String(currentDate.value.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
})

/** Ticketless meetings across the whole displayed month, not just one day. */
const loadMonthUnticketed = async () => {
  const year = currentDate.value.getFullYear()
  const month = currentDate.value.getMonth()
  return entriesStore.loadUnticketedMeetings(
    toLocalDateString(new Date(year, month, 1)),
    toLocalDateString(new Date(year, month + 1, 0))
  )
}

/**
 * Import the displayed month, then refresh the grid and the ticket prompt.
 *
 * Runs whenever a month comes into view. syncCalendarMonth is guarded per
 * month for the session, so paging back and forth does not re-hit Outlook.
 */
const autoSyncDisplayedMonth = async () => {
  const result = await entriesStore.syncCalendarMonth(currentMonthKey.value)
  if (result && result.created > 0) {
    uiStore.showInfo(result.message)
    await loadCalendarEvents(true)
  }
  entriesStore.clearPendingUnmapped()
  unmappedMeetings.value = await loadMonthUnticketed()
}

const loadCalendarEvents = async (skipCache = false) => {
  isLoadingEvents.value = true
  try {
    const year = currentDate.value.getFullYear()
    const month = currentDate.value.getMonth()
    const startDate = toLocalDateString(new Date(year, month, 1))
    const endDate = toLocalDateString(new Date(year, month + 1, 0))

    const result = await executeApi<{ events?: any[] }>('get_outlook_events', {
      startDate,
      endDate,
      skipCache
    })

    const events = asList<Record<string, any>>(result, 'events')
    calendarEvents.value = events.map(event => ({
      id: String(event.id ?? `${event.date}_${event.startTime}_${event.subject}`),
      date: event.date,
      title: event.subject || event.title || 'Untitled',
      startTime: event.startTime || '',
      endTime: event.endTime || '',
      duration: event.duration || 0,
      location: event.location || undefined,
      description: event.bodyPreview || event.description,
      isAllDay: Boolean(event.isAllDay),
      priority: event.isReminderOn ? 'high' : 'normal'
    }))
  } catch (error) {
    console.error('Failed to load calendar events:', error)
    calendarEvents.value = []
  } finally {
    isLoadingEvents.value = false
  }
}

const syncCalendarToEntries = async () => {
  const result = await entriesStore.syncCalendarMonth(currentMonthKey.value, { force: true })
  if (!result) {
    uiStore.showError(entriesStore.calendarSyncMessage || 'Calendar sync failed')
    return
  }
  await loadCalendarEvents(true)
  if (result.clashed && result.clashed > 0) uiStore.showInfo(result.message)
  else if (result.created > 0) uiStore.showSuccess(result.message)
  else uiStore.showInfo(result.message)

  // Meetings that matched no keyword have no ticket, so ask rather than
  // leaving them silently unsubmittable.
  entriesStore.clearPendingUnmapped()
  unmappedMeetings.value = await loadMonthUnticketed()
}

const onPromptClose = async (assignedCount: number) => {
  unmappedMeetings.value = []
  if (assignedCount > 0) {
    await loadCalendarEvents(true)
    uiStore.showSuccess(`Assigned tickets to ${assignedCount} meeting(s)`)
  }
}

const previousMonth = async () => {
  currentDate.value = new Date(currentDate.value.getFullYear(), currentDate.value.getMonth() - 1)
  await loadCalendarEvents()
  await autoSyncDisplayedMonth()
}

const nextMonth = async () => {
  currentDate.value = new Date(currentDate.value.getFullYear(), currentDate.value.getMonth() + 1)
  await loadCalendarEvents()
  await autoSyncDisplayedMonth()
}

const goToToday = async () => {
  currentDate.value = new Date()
  selectedDate.value = toLocalDateString(new Date())
  await loadCalendarEvents()
  await autoSyncDisplayedMonth()
}

const formatTime = (time: string) => {
  if (!time) return ''
  const [hours, minutes] = time.split(':')
  return `${hours}:${minutes}`
}

const createEntryFromEvent = async (event: CalendarEvent) => {
  const [startHour, startMin] = event.startTime.split(':').map(Number)
  const [endHour, endMin] = event.endTime.split(':').map(Number)
  const startMins = startHour * 60 + startMin
  const endMins = endHour * 60 + endMin
  const duration = endMins - startMins

  try {
    await entriesStore.addEntry({
      date: selectedDate.value,
      taskName: event.title,
      startTime: event.startTime,
      endTime: event.endTime,
      duration
    })

    uiStore.showSuccess(`Created time entry for "${event.title}"`)
    entriesStore.syncEntriesPersist()
    selectedEvent.value = null
  } catch (error) {
    uiStore.showError('Failed to create time entry')
  }
}

onMounted(async () => {
  await loadCalendarEvents()
  // Opening the calendar imports the whole month on view, so the grid reflects
  // Outlook rather than only the day that happened to be selected.
  await autoSyncDisplayedMonth()
})
</script>

<style scoped>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

.calendar-page {
  min-height: 100vh;
  color: #e2e8f0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
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
  flex-wrap: wrap;
  gap: 1rem;
}

.header-content h1 {
  font-size: 1.8rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
}

.month-display {
  font-size: 1.1rem;
  color: #06b6d4;
  font-weight: 600;
}

.header-actions {
  display: flex;
  gap: 1rem;
}

.btn-nav,
.btn-today {
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

.btn-nav:hover,
.btn-today:hover {
  background: rgba(51, 65, 85, 0.8);
  border-color: rgba(148, 163, 184, 0.4);
}

.btn-today {
  background: rgba(6, 182, 212, 0.2);
  border-color: #06b6d4;
  color: #06b6d4;
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

.calendar-day.selected {
  border-color: #06b6d4;
  box-shadow: 0 0 0 1px #06b6d4;
}

/* Content */
.calendar-content {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 300px;
  gap: 2rem;
  padding: 2rem 3rem;
  max-width: 1600px;
  margin: 0 auto;
  width: 100%;
}

/* Calendar */
.calendar-container {
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 0.75rem;
  padding: 1.5rem;
  backdrop-filter: blur(10px);
  overflow: hidden;
}

.calendar-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 1rem;
  margin-bottom: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
}

.weekday {
  font-weight: 600;
  text-align: center;
  color: #94a3b8;
  text-transform: uppercase;
  font-size: 0.85rem;
  letter-spacing: 0.05em;
}

.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 1rem;
}

.calendar-day {
  aspect-ratio: 1;
  background: rgba(51, 65, 85, 0.3);
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 0.5rem;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  cursor: pointer;
  transition: all 0.3s ease;
  min-height: 100px;
}

.calendar-day:hover {
  border-color: rgba(148, 163, 184, 0.3);
  background: rgba(51, 65, 85, 0.5);
}

.calendar-day.other-month {
  opacity: 0.4;
}

.calendar-day.today {
  background: rgba(6, 182, 212, 0.2);
  border-color: #06b6d4;
}

.calendar-day.has-events {
  background: rgba(30, 41, 59, 0.95);
}

.day-number {
  font-weight: 600;
  font-size: 0.95rem;
  color: #e2e8f0;
  margin-bottom: 0.5rem;
}

.day-events {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  flex: 1;
  overflow-y: auto;
}

.event-badge {
  padding: 0.25rem 0.5rem;
  background: rgba(6, 182, 212, 0.2);
  border: 1px solid rgba(6, 182, 212, 0.3);
  border-radius: 0.25rem;
  font-size: 0.75rem;
  color: #06b6d4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  transition: all 0.3s ease;
}

.event-badge:hover {
  background: rgba(6, 182, 212, 0.3);
}

.event-badge.priority-high {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.3);
  color: #ef4444;
}

.event-more {
  font-size: 0.7rem;
  color: #94a3b8;
  padding: 0.25rem 0.5rem;
}

/* Sidebar */
.calendar-sidebar {
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 0.75rem;
  padding: 1.5rem;
  backdrop-filter: blur(10px);
  display: flex;
  flex-direction: column;
  max-height: 600px;
  overflow-y: auto;
}

.calendar-sidebar h2 {
  font-size: 1.1rem;
  font-weight: 700;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
}

.events-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.event-item {
  padding: 1rem;
  background: rgba(51, 65, 85, 0.3);
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 0.5rem;
  transition: all 0.3s ease;
  cursor: pointer;
}

.event-item:hover {
  background: rgba(51, 65, 85, 0.5);
  border-color: rgba(148, 163, 184, 0.3);
}

.event-item.priority-high {
  border-color: rgba(239, 68, 68, 0.3);
  background: rgba(239, 68, 68, 0.1);
}

.event-time {
  font-size: 0.85rem;
  color: #94a3b8;
  font-family: 'Space Mono', monospace;
  margin-bottom: 0.5rem;
}

.event-content h3 {
  font-size: 0.95rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
  color: #e2e8f0;
}

.event-description {
  font-size: 0.85rem;
  color: #cbd5e1;
  margin-bottom: 0.75rem;
  line-height: 1.4;
}

.event-meta {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.8rem;
  color: #94a3b8;
}

.event-duration,
.event-location {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.btn-add-entry {
  padding: 0.4rem 0.8rem;
  background: rgba(6, 182, 212, 0.2);
  border: 1px solid #06b6d4;
  color: #06b6d4;
  border-radius: 0.4rem;
  cursor: pointer;
  font-weight: 600;
  font-size: 0.85rem;
  margin-top: 0.75rem;
  transition: all 0.3s ease;
}

.btn-add-entry:hover {
  background: rgba(6, 182, 212, 0.3);
}

/* Empty State */
.empty-state {
  text-align: center;
  padding: 2rem;
  color: #94a3b8;
}

.empty-icon {
  font-size: 2rem;
  margin-bottom: 0.75rem;
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

.modal-close:hover {
  color: #e2e8f0;
}

.event-details {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.detail-row {
  display: flex;
  gap: 1rem;
}

.detail-row.full-width {
  flex-direction: column;
}

.label {
  font-weight: 600;
  color: #94a3b8;
  min-width: 80px;
}

.value {
  color: #e2e8f0;
  flex: 1;
}

.btn-add-entry.full-width {
  width: 100%;
  padding: 0.75rem;
  margin-top: 1rem;
}

/* Scrollbar */
.calendar-sidebar::-webkit-scrollbar {
  width: 6px;
}

.calendar-sidebar::-webkit-scrollbar-track {
  background: transparent;
}

.calendar-sidebar::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.2);
  border-radius: 3px;
}

.calendar-sidebar::-webkit-scrollbar-thumb:hover {
  background: rgba(148, 163, 184, 0.4);
}

/* Responsive */
@media (max-width: 1024px) {
  .calendar-content {
    grid-template-columns: 1fr;
    padding: 1.5rem;
  }

  .calendar-sidebar {
    max-height: none;
  }
}

@media (max-width: 768px) {
  .page-header {
    padding: 1.5rem;
  }

  .header-actions {
    width: 100%;
    justify-content: space-between;
  }

  .calendar-day {
    min-height: 80px;
  }
}
</style>
