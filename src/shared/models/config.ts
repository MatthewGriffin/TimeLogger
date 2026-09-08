export interface JiraConfig {
  baseUrl: string
  email: string
  apiToken: string
  tempoToken?: string
  defaultIssueMapping?: string
}

export interface MicrosoftConfig {
  tenantId: string
  clientId: string
  clientSecret?: string
  connected: boolean
}

export interface OllamaConfig {
  host: string
  model: string
  enabled: boolean
  temperature?: number
  maxTokens?: number
}

export interface OneNoteConfig {
  notebookId?: string
  notebookName?: string
  sectionId?: string
  sectionName?: string
  ticketSectionId?: string
  ticketSectionName?: string
  syncEnabled: boolean
}

export interface CalendarConfig {
  includeAllDayEvents: boolean
  filterLabel?: string
  enabled?: boolean
  refreshInterval?: string
  syncOnStartup?: boolean
}

export interface LunchConfig {
  enabled: boolean
  name: string
  startTime: string
  endTime: string
}

export interface WorkdayConfig {
  startTime: string
  endTime: string
}

export interface TempoReminderConfig {
  enabled: boolean
  time: string
  days: 'weekdays' | 'everyday'
}

export interface NotificationsConfig {
  enabled: boolean
  submissionAlerts: boolean
  tempoReminder: TempoReminderConfig
}

export interface AppConfig {
  jira?: JiraConfig
  microsoft?: MicrosoftConfig
  ollama?: OllamaConfig
  oneNote?: OneNoteConfig
  calendar?: CalendarConfig
  lunch: LunchConfig
  workday: WorkdayConfig
  autoStart: boolean
  startMinimized: boolean
  notifications?: NotificationsConfig
  lastUpdated: string
}
