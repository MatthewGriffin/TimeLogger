import { defineStore } from 'pinia'
import { ref } from 'vue'
import { executeApi, ApiError } from '@/shared/utils/api'
import {
  normalizeConfig,
  type AppConfig,
  type JiraConfig,
  type MicrosoftConfig,
  type OllamaConfig,
  type OneNoteConfig,
  type CalendarConfig
} from '@/shared/utils/state-adapters'

export type { AppConfig, JiraConfig, MicrosoftConfig, OllamaConfig, OneNoteConfig, CalendarConfig }

export interface IntegrationStatus {
  jira: boolean
  microsoft: boolean
  ollama: boolean
  oneNote: boolean
  tempo: boolean
}
export type IntegrationHealth = 'not-enabled' | 'configured' | 'failed'
type ConfigSection = keyof Pick<AppConfig, 'jira' | 'microsoft' | 'ollama' | 'oneNote' | 'calendar'>

const emptyConfig = (): AppConfig => ({
  lunch: { enabled: true, name: 'Lunch', startTime: '12:00', endTime: '13:00' },
  workday: { startTime: '09:00', endTime: '17:00' },
  autoStart: false,
  startMinimized: false,
  lastUpdated: new Date().toISOString()
})

export const useConfigStore = defineStore('config', () => {
  const config = ref<AppConfig>(emptyConfig())
  const integrationStatus = ref<IntegrationStatus>({ jira: false, microsoft: false, ollama: false, oneNote: false, tempo: false })
  const integrationHealth = ref<Record<keyof IntegrationStatus, IntegrationHealth>>({
    jira: 'not-enabled', microsoft: 'not-enabled', ollama: 'not-enabled', oneNote: 'not-enabled', tempo: 'not-enabled'
  })
  const testStatus = ref<Record<keyof IntegrationStatus, 'idle' | 'testing' | 'success' | 'failed'>>({
    jira: 'idle', microsoft: 'idle', ollama: 'idle', oneNote: 'idle', tempo: 'idle'
  })
  const isLoading = ref(false)
  const isSaving = ref(false)
  const isTestingConnections = ref(false)
  const hasLoaded = ref(false)
  const error = ref('')

  const isJiraConfigured = () => Boolean(config.value.jira?.baseUrl && config.value.jira?.apiToken)
  const isMicrosoftConfigured = () => Boolean(config.value.microsoft?.connected)
  const isOllamaConfigured = () => Boolean(config.value.ollama?.host && config.value.ollama?.enabled)
  const isOneNoteConfigured = () => Boolean(config.value.oneNote?.syncEnabled)
  const isTempoConfigured = () => Boolean(config.value.jira?.tempoToken)

  const setConfig = (value: unknown) => {
    config.value = normalizeConfig(value)
    integrationHealth.value.tempo = isTempoConfigured() ? 'configured' : 'not-enabled'
  }

  const readFallback = (): AppConfig | null => {
    try {
      const stored = localStorage.getItem('timelogger_config')
      return stored ? normalizeConfig(JSON.parse(stored)) : null
    } catch {
      return null
    }
  }

  const loadConfig = async () => {
    isLoading.value = true
    error.value = ''
    try {
      setConfig(await executeApi('get_config', {}))
      syncConfigPersist()
      hasLoaded.value = true
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : 'Failed to load config'
      const fallback = readFallback()
      if (fallback) {
        config.value = fallback
        hasLoaded.value = true
      }
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const saveConfig = async (newConfig: Partial<AppConfig>) => {
    isSaving.value = true
    isLoading.value = true
    error.value = ''
    const merged: Record<string, unknown> = { ...config.value }
    Object.entries(newConfig).forEach(([key, value]) => {
      if (value !== undefined) merged[key] = value
    })
    const updated = normalizeConfig({ ...merged, lastUpdated: new Date().toISOString() })
    try {
      const result = await executeApi('update_config', { config: updated })
      setConfig(result)
      syncConfigPersist()
      hasLoaded.value = true
      return config.value
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : 'Failed to save config'
      throw err
    } finally {
      isSaving.value = false
      isLoading.value = false
    }
  }

  const updateSection = async <K extends ConfigSection>(section: K, value: Partial<NonNullable<AppConfig[K]>>) => {
    const current = (config.value[section] || {}) as object
    return saveConfig({ [section]: { ...current, ...value } } as Partial<AppConfig>)
  }
  const updateJiraConfig = (value: Partial<JiraConfig>) => updateSection('jira', value)
  const updateMicrosoftConfig = (value: Partial<MicrosoftConfig>) => updateSection('microsoft', value)
  const updateOllamaConfig = (value: Partial<OllamaConfig>) => updateSection('ollama', value)
  const updateOneNoteConfig = (value: Partial<OneNoteConfig>) => updateSection('oneNote', value)
  const updateCalendarConfig = (value: Partial<CalendarConfig>) => updateSection('calendar', value)
  const updateAutoStart = (value: boolean) => saveConfig({ autoStart: value })
  const updateStartMinimized = (value: boolean) => saveConfig({ startMinimized: value })

  const testJiraConnection = async () => {
    testStatus.value.jira = 'testing'; isTestingConnections.value = true; error.value = ''
    try {
      if (!isJiraConfigured()) throw new Error('Jira configuration is incomplete')
      await executeApi('test_jira_connection', { baseUrl: config.value.jira!.baseUrl, email: config.value.jira!.email, apiToken: config.value.jira!.apiToken })
      integrationStatus.value.jira = true; integrationHealth.value.jira = 'configured'; testStatus.value.jira = 'success'; return true
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : String(err)
      integrationStatus.value.jira = false; integrationHealth.value.jira = 'failed'; testStatus.value.jira = 'failed'; return false
    } finally { isTestingConnections.value = false }
  }

  const testOllamaConnectionOnly = async () => {
    testStatus.value.ollama = 'testing'; isTestingConnections.value = true; error.value = ''
    try {
      if (!config.value.ollama?.host) throw new Error('Ollama host is not configured')
      await executeApi('test_ollama_connection', { host: config.value.ollama.host })
      integrationStatus.value.ollama = true; integrationHealth.value.ollama = 'configured'; testStatus.value.ollama = 'success'; return true
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : String(err)
      integrationStatus.value.ollama = false; integrationHealth.value.ollama = 'failed'; testStatus.value.ollama = 'failed'; return false
    } finally { isTestingConnections.value = false }
  }

  const testConnections = async () => {
    await Promise.all([isJiraConfigured() ? testJiraConnection() : Promise.resolve(false), isOllamaConfigured() ? testOllamaConnectionOnly() : Promise.resolve(false)])
    integrationHealth.value.oneNote = isOneNoteConfigured() ? 'configured' : 'not-enabled'
    integrationHealth.value.tempo = isTempoConfigured() ? 'configured' : 'not-enabled'
  }

  const syncConfigPersist = () => localStorage.setItem('timelogger_config', JSON.stringify(config.value))
  const loadConfigFromBackend = async () => {
    if (!hasLoaded.value) await loadConfig()
  }

  return {
    config, integrationStatus, integrationHealth, testStatus, isLoading, isSaving, isTestingConnections, hasLoaded, error,
    isJiraConfigured, isMicrosoftConfigured, isOllamaConfigured, isOneNoteConfigured, isTempoConfigured,
    loadConfig, loadConfigFromBackend, saveConfig, updateJiraConfig, updateMicrosoftConfig, updateOllamaConfig,
    updateOneNoteConfig, updateCalendarConfig, updateAutoStart, updateStartMinimized, testConnections,
    testJiraConnection, testOllamaConnectionOnly, syncConfigPersist
  }
})
