import type { JiraConfig, MicrosoftConfig, OllamaConfig, OneNoteConfig } from '@/shared/models/config'

export type SettingsTabName =
  | 'Jira & Tempo'
  | 'Current Sprint'
  | 'Microsoft'
  | 'OneNote'
  | 'Calendar'
  | 'Ollama'
  | 'App Settings'
  | 'Database & Data'
  | 'About'

export interface SprintMappingForm {
  id: string
  label: string
  jiraType: string
  ticketKey: string
  aliasText: string
}

export interface CurrentSprintSettingsForm {
  piNumber: string
  projectKey: string
  teamLabel: string
  defaultMeetingTicket: string
  mappings: SprintMappingForm[]
}

export interface SprintTestResult {
  matched: boolean
  text: string
}

export interface JiraTempoSettingsForm extends Omit<JiraConfig, 'tempoToken' | 'defaultIssueMapping'> {
  tempoToken: string
  defaultIssueMapping: string
}

export interface MicrosoftSettingsForm extends Omit<MicrosoftConfig, 'clientSecret'> {
  clientSecret: string
  oauthUrl: string
  enabled: boolean
}

export interface OllamaSettingsForm extends Omit<OllamaConfig, 'temperature' | 'maxTokens'> {
  temperature: number
  maxTokens: number
}

export interface OneNoteSettingsForm extends Omit<OneNoteConfig, 'notebookId' | 'notebookName' | 'sectionId' | 'sectionName' | 'ticketSectionId' | 'ticketSectionName'> {
  notebookId: string
  notebookName: string
  sectionId: string
  sectionName: string
  ticketSectionId: string
  ticketSectionName: string
}

export interface CalendarSettingsForm {
  includeAllDayEvents: boolean
  filterLabel: string
  enabled: boolean
  refreshInterval: string
  syncOnStartup: boolean
}

export interface OneNoteSection {
  id: string
  displayName: string
}

export interface OneNoteNotebook {
  id: string
  displayName: string
  sections?: OneNoteSection[]
}

export interface GraphProbe {
  available?: boolean
  reason?: string | null
}

export interface GraphCapabilities {
  onenote?: GraphProbe
}

export interface OAuthStatus {
  success?: boolean
  failed?: boolean
  message?: string | null
  connected?: boolean
  account?: string | null
  capabilities?: GraphCapabilities | null
}

export interface AppSettingsForm {
  autoStart: boolean
  startMinimized: boolean
  theme: string
  lunch: {
    enabled: boolean
    name: string
    startTime: string
    endTime: string
  }
  workday: {
    startTime: string
    endTime: string
  }
  notifications: {
    enabled: boolean
    submissionAlerts: boolean
    dailyReminders: boolean
    dailyReminderTime: string
    tempoReminder: {
      enabled: boolean
      time: string
      days: 'weekdays' | 'everyday'
    }
  }
}

export interface SettingsFormData extends AppSettingsForm {
  jira: JiraTempoSettingsForm
  microsoft: MicrosoftSettingsForm
  ollama: OllamaSettingsForm
  oneNote: OneNoteSettingsForm
  calendar: CalendarSettingsForm
}

export interface GraphBlocker {
  name: string
  reason: string
}
