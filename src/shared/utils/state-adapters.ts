export type { AppConfig, CalendarConfig, JiraConfig, LunchConfig, MicrosoftConfig, NotificationsConfig, OllamaConfig, OneNoteConfig, TempoReminderConfig, WorkdayConfig } from '@/shared/models/config'
export type { Note, NoteTopic } from '@/shared/models/note'
export type { TimeEntry } from '@/shared/models/time-entry'

import type { AppConfig, LunchConfig, NotificationsConfig, WorkdayConfig } from '@/shared/models/config'
import type { Note } from '@/shared/models/note'
import type { TimeEntry } from '@/shared/models/time-entry'

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected an object response')
  }
  return value as Record<string, unknown>
}

const collection = (value: unknown, key: string): unknown[] => {
  if (Array.isArray(value)) return value
  const record = asRecord(value)
  if (!Array.isArray(record[key])) throw new Error(`Expected ${key} to be an array`)
  return record[key] as unknown[]
}

export function normalizeTimeEntries(value: unknown): TimeEntry[] {
  return collection(value, 'entries').map((raw) => {
    const entry = asRecord(raw)
    const date = entry.date
    const taskName = entry.name ?? entry.taskName
    const startTime = entry.start_time ?? entry.startTime ?? ''
    const endTime = entry.end_time ?? entry.endTime ?? ''
    if (typeof date !== 'string' || typeof taskName !== 'string') {
      throw new Error('Invalid time entry response')
    }
    const id = entry.id ?? entry.entryId ?? (Array.isArray(entry.entryIds) ? entry.entryIds[0] : undefined)
    if (id === undefined || id === null) throw new Error('Time entry is missing an ID')
    return {
      id: String(id),
      date,
      taskName,
      ticketId: entry.ticket_id != null ? String(entry.ticket_id) : (entry.ticketId != null ? String(entry.ticketId) : undefined),
      startTime: String(startTime),
      endTime: String(endTime),
      duration: Number(entry.duration_minutes ?? entry.duration_mins ?? entry.duration ?? 0),
      submitted: Boolean(entry.submitted),
      submittedAt: entry.submitted_at != null ? String(entry.submitted_at) : undefined,
      activityType: entry.activity_type != null ? String(entry.activity_type) : undefined,
      // Needed to tell an untouched day apart from one already filled from the
      // calendar. The backend column is `from_calendar`; there is no `source`.
      fromCalendar: Boolean(entry.from_calendar ?? entry.fromCalendar)
    }
  })
}

export function normalizeNotes(value: unknown): Note[] {
  return collection(value, 'notes').map((raw) => {
    const note = asRecord(raw)
    const id = note.id
    const content = note.note ?? note.content
    if (id === undefined || id === null || typeof content !== 'string') {
      throw new Error('Invalid note response')
    }
    const topic = typeof note.topic === 'string' && note.topic.trim() ? note.topic : 'General'
    const createdAt = String(note.created_at ?? note.createdAt ?? new Date().toISOString())
    const updatedAt = String(note.updated_at ?? note.updatedAt ?? createdAt)
    return {
      id: String(id),
      title: typeof note.title === 'string' ? note.title : content.split(/\r?\n/, 1)[0].slice(0, 80),
      content,
      topic,
      createdAt,
      updatedAt,
      oneNoteSynced: Boolean(note.one_note_synced ?? note.oneNoteSynced),
      oneNoteId: note.one_note_id != null ? String(note.one_note_id) : undefined,
      date: note.date != null ? String(note.date) : undefined,
      ticketId: note.ticket_id != null ? String(note.ticket_id) : undefined
    }
  })
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

function normalizeLunch(value: unknown): LunchConfig {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const time = (candidate: unknown, fallback: string) =>
    typeof candidate === 'string' && TIME_PATTERN.test(candidate) ? candidate : fallback
  return {
    enabled: source.enabled !== false,
    name: typeof source.name === 'string' && source.name.trim() ? source.name.trim() : 'Lunch',
    startTime: time(source.startTime, '12:00'),
    endTime: time(source.endTime, '13:00')
  }
}

function normalizeWorkday(value: unknown): WorkdayConfig {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const time = (candidate: unknown, fallback: string) =>
    typeof candidate === 'string' && TIME_PATTERN.test(candidate) ? candidate : fallback
  return {
    startTime: time(source.startTime, '09:00'),
    endTime: time(source.endTime, '17:00')
  }
}

export function normalizeNotifications(value: unknown): NotificationsConfig {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const reminder = (source.tempoReminder && typeof source.tempoReminder === 'object'
    ? source.tempoReminder
    : {}) as Record<string, unknown>
  return {
    enabled: source.enabled !== false,
    submissionAlerts: source.submissionAlerts !== false,
    tempoReminder: {
      enabled: reminder.enabled === true,
      time: typeof reminder.time === 'string' && TIME_PATTERN.test(reminder.time) ? reminder.time : '16:30',
      days: reminder.days === 'everyday' ? 'everyday' : 'weekdays'
    }
  }
}

export function normalizeConfig(value: unknown): AppConfig {
  const response = asRecord(value)
  const source = (response.config && typeof response.config === 'object')
    ? asRecord(response.config)
    : response
  const jira = source.jira ?? source.jiraConfig
  const microsoft = source.microsoft ?? source.microsoft_config ?? source.outlook ?? source.outlookConfig
  const ollama = source.ollama ?? source.ollama_config ?? source.ollamaConfig
  const oneNote = source.oneNote ?? source.onenote ?? source.onenote_config ?? source.onenoteConfig
  const calendar = source.calendar ?? source.calendar_config
  const app = source.app ?? source.app_config
  const asOptionalRecord = (section: unknown) => section && typeof section === 'object' ? section as Record<string, unknown> : undefined
  const j = asOptionalRecord(jira)
  const m = asOptionalRecord(microsoft)
  const o = asOptionalRecord(ollama)
  const n = asOptionalRecord(oneNote)
  const c = asOptionalRecord(calendar)
  const a = asOptionalRecord(app)
  return {
    jira: j ? {
      baseUrl: String(j.baseUrl ?? j.base_url ?? ''),
      email: String(j.email ?? ''),
      apiToken: String(j.apiToken ?? j.api_token ?? ''),
      tempoToken: j.tempoToken != null ? String(j.tempoToken) : (j.tempo_token != null ? String(j.tempo_token) : undefined),
      defaultIssueMapping: j.defaultIssueMapping != null ? String(j.defaultIssueMapping) : undefined
    } : undefined,
    microsoft: m ? {
      tenantId: String(m.tenantId ?? m.tenant_id ?? ''),
      clientId: String(m.clientId ?? m.client_id ?? ''),
      clientSecret: m.clientSecret != null ? String(m.clientSecret) : undefined,
      connected: Boolean(m.connected)
    } : undefined,
    ollama: o ? {
      host: String(o.host ?? ''),
      model: String(o.model ?? 'llama3.2:1b'),
      enabled: Boolean(o.enabled),
      temperature: o.temperature == null ? undefined : Number(o.temperature),
      maxTokens: o.maxTokens == null ? undefined : Number(o.maxTokens)
    } : undefined,
    oneNote: n ? {
      notebookId: n.notebookId != null ? String(n.notebookId) : undefined,
      notebookName: n.notebookName != null ? String(n.notebookName) : undefined,
      sectionId: n.sectionId != null ? String(n.sectionId) : undefined,
      sectionName: n.sectionName != null ? String(n.sectionName) : undefined,
      ticketSectionId: n.ticketSectionId != null ? String(n.ticketSectionId) : undefined,
      ticketSectionName: n.ticketSectionName != null ? String(n.ticketSectionName) : undefined,
      syncEnabled: Boolean(n.syncEnabled)
    } : undefined,
    calendar: c ? {
      includeAllDayEvents: c.includeAllDayEvents === true,
      filterLabel: c.filterLabel != null ? String(c.filterLabel) : undefined,
      enabled: c.enabled == null ? undefined : Boolean(c.enabled),
      refreshInterval: c.refreshInterval != null ? String(c.refreshInterval) : undefined,
      syncOnStartup: c.syncOnStartup == null ? undefined : Boolean(c.syncOnStartup)
    } : undefined,
    lunch: normalizeLunch(source.lunch ?? a?.lunch),
    workday: normalizeWorkday(source.workday ?? a?.workday),
    autoStart: Boolean(source.autoStart ?? a?.autoStart),
    startMinimized: Boolean(source.startMinimized ?? a?.startMinimized),
    notifications: normalizeNotifications(source.notifications),
    lastUpdated: String(source.lastUpdated ?? a?.lastUpdated ?? new Date().toISOString())
  }
}
