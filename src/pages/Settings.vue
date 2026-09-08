<template>
  <div class="settings-page">
    <!-- Page Header -->
    <div class="page-header">
      <h1>Settings</h1>
      <button class="btn-save" @click="saveSettings" :disabled="!hasChanges">
        {{ isSaving ? 'Saving...' : 'Save Changes' }}
      </button>
    </div>

    <!-- Content -->
    <div class="settings-content">
      <!-- Tabs -->
      <div class="settings-tabs">
        <button
          v-for="tab in tabs"
          :key="tab"
          :class="['tab-button', { active: activeTab === tab }]"
          @click="activeTab = tab"
        >
          {{ getTabIcon(tab) }} {{ tab }}
        </button>
      </div>

      <!-- Tab Content -->
      <div class="tab-content">
        <JiraTempoSettings
          v-if="activeTab === 'Jira & Tempo'"
          :form-data="formData.jira"
        />
        <CurrentSprintSettings
          v-if="activeTab === 'Current Sprint'"
          :form-data="sprintForm"
          :lookup-busy="sprintLookupBusy"
          :lookup-message="sprintLookupMessage"
          :lookup-ok="sprintLookupOk"
          v-model:test-subject="sprintTestSubject"
          :test-result="sprintTestResult"
          @lookup-pi-tickets="lookupPiTickets"
          @test-meeting-match="testMeetingMatch"
        />
        <MicrosoftSettings
          v-if="activeTab === 'Microsoft'"
          :form-data="formData.microsoft"
          :microsoft-connected="microsoftConnected"
          :microsoft-account="microsoftAccount"
          :graph-blockers="graphBlockers"
          :can-connect-microsoft="canConnectMicrosoft"
          :is-connecting-microsoft="isConnectingMicrosoft"
          :microsoft-connect-message="microsoftConnectMessage"
          :microsoft-connect-failed="microsoftConnectFailed"
          @connect-microsoft="connectMicrosoft"
        />
        <OneNoteSettings
          v-if="activeTab === 'OneNote'"
          :form-data="formData.oneNote"
          :notebooks="notebooks"
          :available-sections="availableSections"
          :is-loading-notebooks="isLoadingNotebooks"
          :notebook-error="notebookError"
          @load-notebooks="loadNotebooks"
          @notebook-changed="onNotebookChanged"
        />
        <CalendarSettings
          v-if="activeTab === 'Calendar'"
          :form-data="formData.calendar"
        />
        <OllamaSettings
          v-if="activeTab === 'Ollama'"
          :form-data="formData.ollama"
          @validate-host="validateOllamaHost"
        />

        <AppSettings
          v-if="activeTab === 'App Settings'"
          :form-data="formData"
          :is-sending-test-notification="isSendingTestNotification"
          @send-test-notification="sendTestNotification"
        />
        <DatabaseSettings
          v-if="activeTab === 'Database & Data'"
          :database-path="databasePath"
          :database-size="databaseSize"
          @export-json="exportDataAsJson"
          @export-csv="exportDataAsCsv"
          @import="importData"
          @view-logs="viewLogs"
          @clear-data="clearAllData"
        />

        <AboutSettings
          v-if="activeTab === 'About'"
          :build-date="buildDate"
          @check-updates="checkForUpdates"
          @open-documentation="openDocumentation"
          @report-issue="reportIssue"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { executeApi, asList } from '../utils/api'
import { asRecord, asString, asBoolean } from '../utils/schema'
import { useConfigStore } from '../stores/config'
import { useEntriesStore } from '../stores/entries'
import { useUiStore } from '../stores/ui'
import { refreshTempoReminder } from '../composables/useTempoReminder'
import { useUpdater } from '../composables/useUpdater'
import CalendarSettings from '../components/settings/CalendarSettings.vue'
import AboutSettings from '../components/settings/AboutSettings.vue'
import CurrentSprintSettings from '../components/settings/CurrentSprintSettings.vue'
import DatabaseSettings from '../components/settings/DatabaseSettings.vue'
import AppSettings from '../components/settings/AppSettings.vue'
import JiraTempoSettings from '../components/settings/JiraTempoSettings.vue'
import MicrosoftSettings from '../components/settings/MicrosoftSettings.vue'
import OneNoteSettings from '../components/settings/OneNoteSettings.vue'
import OllamaSettings from '../components/settings/OllamaSettings.vue'
import type {
  CurrentSprintSettingsForm,
  GraphBlocker,
  GraphCapabilities,
  OAuthStatus,
  OneNoteNotebook,
  OneNoteSection,
  SettingsFormData,
  SettingsTabName,
  SprintMappingForm,
  SprintTestResult,
} from '../models/settings'

const configStore = useConfigStore()
const entriesStore = useEntriesStore()
const uiStore = useUiStore()
const updater = useUpdater()

const tabs: SettingsTabName[] = ['Jira & Tempo', 'Current Sprint', 'Microsoft', 'OneNote', 'Calendar', 'Ollama', 'App Settings', 'Database & Data', 'About']
const activeTab = ref<SettingsTabName>('Jira & Tempo')
const isSaving = ref(false)
const databasePath = ref('~/.timelogger/data.db')
const databaseSize = ref('12.4 MB')
const buildDate = ref(new Date().toLocaleDateString())
const formData = ref<SettingsFormData>({
  jira: {
    baseUrl: '',
    email: '',
    apiToken: '',
    tempoToken: '',
    defaultIssueMapping: ''
  },
  microsoft: {
    tenantId: '',
    clientId: '',
    clientSecret: '',
    oauthUrl: '',
    connected: false,
    enabled: false
  },
  ollama: {
    host: 'http://localhost:11434',
    model: 'llama3.2:1b',
    enabled: false,
    temperature: 0.7,
    maxTokens: 256
  },
  oneNote: {
    notebookId: '',
    notebookName: '',
    sectionId: '',
    sectionName: '',
    ticketSectionId: '',
    ticketSectionName: '',
    syncEnabled: false
  },
  calendar: {
    includeAllDayEvents: false,
    filterLabel: '',
    enabled: false,
    refreshInterval: '30',
    syncOnStartup: true
  },
  autoStart: false,
  startMinimized: false,
  lunch: {
    enabled: true,
    name: 'Lunch',
    startTime: '12:00',
    endTime: '13:00'
  },
  workday: {
    startTime: '09:00',
    endTime: '17:00'
  },
  theme: 'auto',
  notifications: {
    enabled: true,
    submissionAlerts: true,
    dailyReminders: true,
    dailyReminderTime: '09:00',
    tempoReminder: {
      enabled: false,
      time: '16:30',
      days: 'weekdays' as 'weekdays' | 'everyday'
    }
  }
})

const originalData = ref<SettingsFormData>({ ...formData.value })

const sprintForm = ref<CurrentSprintSettingsForm>({
  piNumber: '',
  projectKey: 'TIME',
  teamLabel: '',
  defaultMeetingTicket: '',
  mappings: [] as SprintMappingForm[]
})
const originalSprint = ref('')
const sprintLookupBusy = ref(false)
const sprintLookupMessage = ref('')
const sprintLookupOk = ref(false)
const sprintTestSubject = ref('')
const sprintTestResult = ref<SprintTestResult | null>(null)

const splitAliases = (text: string): string[] =>
  text.split(',').map(a => a.trim()).filter(Boolean)

const applySprintConfig = (config: Record<string, unknown>): void => {
  sprintForm.value = {
    piNumber: asString(config.piNumber, ''),
    projectKey: asString(config.projectKey, 'TIME'),
    teamLabel: asString(config.teamLabel, ''),
    defaultMeetingTicket: asString(config.defaultMeetingTicket, ''),
    mappings: asList(config.mappings).map(raw => {
      const row = asRecord(raw)
      return {
        id: asString(row.id, ''),
        label: asString(row.label, ''),
        jiraType: asString(row.jiraType, ''),
        ticketKey: asString(row.ticketKey, ''),
        aliasText: asList(row.aliases).map(a => asString(a, '')).filter(Boolean).join(', ')
      }
    })
  }
  originalSprint.value = JSON.stringify(sprintForm.value)
}

const loadSprintConfig = async (): Promise<void> => {
  try {
    const result = asRecord(await executeApi('sprint_get_config', {}))
    if (result.config) applySprintConfig(asRecord(result.config))
  } catch (err) {
    console.error('Failed to load sprint config:', err)
  }
}

const lookupPiTickets = async (): Promise<void> => {
  sprintLookupBusy.value = true
  sprintLookupMessage.value = ''
  try {
    const result = asRecord(await executeApi('sprint_lookup_pi_tickets', {
      piNumber: sprintForm.value.piNumber,
      projectKey: sprintForm.value.projectKey,
      teamLabel: sprintForm.value.teamLabel
    }))
    sprintLookupOk.value = asBoolean(result.success, false)
    sprintLookupMessage.value = asString(result.message, '')

    if (sprintLookupOk.value) {
      // Only ticket keys are refreshed; user-edited keywords are preserved.
      const byId = new Map<string, string>()
      for (const raw of asList(result.matched)) {
        const row = asRecord(raw)
        byId.set(asString(row.id, ''), asString(row.ticketKey, ''))
      }
      for (const mapping of sprintForm.value.mappings) {
        const found = byId.get(mapping.id)
        if (found) mapping.ticketKey = found
      }
      const team = asString(result.teamLabel, '')
      if (team && !sprintForm.value.teamLabel) sprintForm.value.teamLabel = team
    }
  } catch (err) {
    sprintLookupOk.value = false
    sprintLookupMessage.value = err instanceof Error ? err.message : 'Lookup failed'
  } finally {
    sprintLookupBusy.value = false
  }
}

const saveSprintConfig = async (): Promise<void> => {
  const result = asRecord(await executeApi('sprint_save_config', {
    piNumber: sprintForm.value.piNumber,
    projectKey: sprintForm.value.projectKey,
    teamLabel: sprintForm.value.teamLabel,
    defaultMeetingTicket: sprintForm.value.defaultMeetingTicket,
    mappings: sprintForm.value.mappings.map(m => ({
      id: m.id,
      label: m.label,
      jiraType: m.jiraType,
      ticketKey: m.ticketKey,
      aliases: splitAliases(m.aliasText)
    }))
  }))
  if (result.config) applySprintConfig(asRecord(result.config))
}

const testMeetingMatch = async (): Promise<void> => {
  try {
    const result = asRecord(await executeApi('sprint_preview_meeting_match', {
      subject: sprintTestSubject.value
    }))
    const matched = asBoolean(result.matched, false)
    sprintTestResult.value = {
      matched,
      text: matched
        ? `✓ ${asString(result.ticketKey, '')} — ${asString(result.label, '')} (matched "${asString(result.matchedAlias, '')}")`
        : '✗ No ticket mapping matches this name. It will sync but cannot be submitted to Tempo.'
    }
  } catch (err) {
    sprintTestResult.value = {
      matched: false,
      text: err instanceof Error ? err.message : 'Test failed'
    }
  }
}

const hasChanges = computed(() => {
  return JSON.stringify(formData.value) !== JSON.stringify(originalData.value)
    || JSON.stringify(sprintForm.value) !== originalSprint.value
})

const getTabIcon = (tab: SettingsTabName) => {
  const icons: Record<SettingsTabName, string> = {
    'Jira & Tempo': '🔗',
    'Current Sprint': '🏃',
    'Microsoft': '📅',
    'OneNote': '📝',
    'Calendar': '📆',
    'Ollama': '🤖',
    'App Settings': '⚙️',
    'Database & Data': '💾',
    'About': 'ℹ️'
  }
  return icons[tab] || '⚙️'
}

const validateOllamaHost = () => {
  if (!formData.value.ollama.host.startsWith('http://') && !formData.value.ollama.host.startsWith('https://')) {
    formData.value.ollama.host = 'http://' + formData.value.ollama.host
  }
}

const isSendingTestNotification = ref(false)

/**
 * Raise a real Windows toast so the user can confirm notifications actually
 * reach them. Failures are surfaced rather than swallowed - a reminder that
 * never appears is worse than an error message.
 */
const sendTestNotification = async () => {
  isSendingTestNotification.value = true
  try {
    await invoke('show_notification', {
      title: '🔔 TimeLogger',
      message: 'Test notification - Windows notifications are working.'
    })
    uiStore.showSuccess('Test notification sent')
  } catch (error) {
    uiStore.showError('Notification failed: ' + (error instanceof Error ? error.message : String(error)))
  } finally {
    isSendingTestNotification.value = false
  }
}

const notebooks = ref<OneNoteNotebook[]>([])
const isLoadingNotebooks = ref(false)
const notebookError = ref('')

const availableSections = computed<OneNoteSection[]>(() => {
  const selected = notebooks.value.find(notebook => notebook.id === formData.value.oneNote.notebookId)
  return asList<OneNoteSection>(selected?.sections)
})

const loadNotebooks = async () => {
  isLoadingNotebooks.value = true
  notebookError.value = ''
  try {
    const result = await executeApi<{ notebooks?: OneNoteNotebook[] }>('onenote_list_notebooks', {})
    const fetched = asList<OneNoteNotebook>(result, 'notebooks')

    // OneNote answers the per-notebook sections call with a transient 503 often
    // enough that a refresh can come back with an empty section list. Keeping
    // the sections we already have stops that from blanking the pickers and
    // making a saved selection look lost.
    notebooks.value = fetched.map(notebook => {
      if (asList<OneNoteSection>(notebook.sections).length > 0) return notebook
      const previous = notebooks.value.find(known => known.id === notebook.id)
      const keptSections = asList<OneNoteSection>(previous?.sections)
      return keptSections.length > 0 ? { ...notebook, sections: keptSections } : notebook
    })

    if (notebooks.value.length === 0) {
      notebookError.value = 'No notebooks found for this account.'
    } else if (availableSections.value.length === 0 && formData.value.oneNote.notebookId) {
      notebookError.value = 'Could not load sections for that notebook — OneNote may be busy. Try again.'
    }
  } catch (error) {
    notebooks.value = []
    notebookError.value = error instanceof Error ? error.message : 'Failed to load notebooks'
  } finally {
    isLoadingNotebooks.value = false
  }
}

// Keep the stored names in step with the ids so other screens can show a label
// without another Graph round-trip.
//
// The saved section is deliberately NOT cleared here. Hydrating the form also
// moves notebookId ('' -> saved id), and treating that as a notebook change
// wiped the saved section every time Settings opened. Clearing now happens in
// onNotebookChanged, which only fires on real user input.
watch(() => formData.value.oneNote.notebookId, (notebookId) => {
  const selected = notebooks.value.find(notebook => notebook.id === notebookId)
  // Only overwrite the saved name once the list is loaded, otherwise the label
  // is lost while the notebooks request is still in flight.
  if (selected) {
    formData.value.oneNote.notebookName = selected.displayName
  } else if (notebooks.value.length > 0) {
    formData.value.oneNote.notebookName = ''
  }
})

const onNotebookChanged = () => {
  formData.value.oneNote.sectionId = ''
  formData.value.oneNote.sectionName = ''
  formData.value.oneNote.ticketSectionId = ''
  formData.value.oneNote.ticketSectionName = ''
}

watch(() => formData.value.oneNote.sectionId, (sectionId) => {
  const selected = availableSections.value.find(section => section.id === sectionId)
  if (selected) {
    formData.value.oneNote.sectionName = selected.displayName
  } else if (availableSections.value.length > 0) {
    formData.value.oneNote.sectionName = ''
  }
})

watch(() => formData.value.oneNote.ticketSectionId, (sectionId) => {
  const selected = availableSections.value.find(section => section.id === sectionId)
  if (selected) {
    formData.value.oneNote.ticketSectionName = selected.displayName
  } else if (availableSections.value.length > 0) {
    formData.value.oneNote.ticketSectionName = ''
  }
})

const exportDataAsJson = () => {
  uiStore.showInfo('Exporting data as JSON...')
  // Implementation would export data
}

const exportDataAsCsv = () => {
  uiStore.showInfo('Exporting data as CSV...')
  // Implementation would export data
}

const importData = () => {
  uiStore.showInfo('Importing data...')
  // Implementation would import data
}

const viewLogs = () => {
  uiStore.showInfo('Opening logs...')
  // Implementation would open logs
}

const clearAllData = () => {
  const confirmed = confirm('⚠️ Are you sure? This will delete all your data permanently. Make sure you have a backup!')
  if (confirmed) {
    uiStore.showInfo('Clearing all data...')
    // Implementation would clear data
  }
}

const checkForUpdates = async () => {
  uiStore.showInfo('Checking for updates…')
  const found = await updater.checkForUpdate()
  // Only the "nothing to do" case needs a toast; anything else is the
  // update dialog's job to show.
  if (!found && updater.stage.value === 'idle') uiStore.showSuccess('TimeLogger is up to date.')
}

const openDocumentation = () => {
  window.open('https://github.com/MatthewGriffin/TimeLogger#readme', '_blank')
}

const reportIssue = () => {
  window.open('https://github.com/MatthewGriffin/TimeLogger/issues/new', '_blank')
}

const microsoftConnected = ref(false)
const microsoftAccount = ref('')
const graphCapabilities = ref<GraphCapabilities | null>(null)

const graphBlockers = computed<GraphBlocker[]>(() => {
  const capabilities = graphCapabilities.value
  if (!microsoftConnected.value || !capabilities) return []
  // Calendar comes from the local Outlook app, so only OneNote reachability
  // reflects on the signed-in Microsoft account.
  const probe = capabilities.onenote
  if (!probe || probe.available !== false) return []
  return [{ name: 'OneNote', reason: probe.reason || 'Not available' }]
})
const isConnectingMicrosoft = ref(false)
const microsoftConnectMessage = ref('')
const microsoftConnectFailed = ref(false)

const canConnectMicrosoft = computed(() =>
  Boolean(formData.value.microsoft.clientId)
)

const refreshMicrosoftConnection = async () => {
  try {
    const status = await invoke<OAuthStatus>('get_oauth_status', { clear: false })
    microsoftConnected.value = Boolean(status?.connected)
    microsoftAccount.value = status?.account || ''
    graphCapabilities.value = status?.capabilities || null
  } catch {
    // Status is advisory only; leave the last known value in place.
  }
}

const connectMicrosoft = async () => {
  if (!canConnectMicrosoft.value) return

  microsoftConnectFailed.value = false
  microsoftConnectMessage.value = 'Saving credentials…'

  // The callback redeems the code using the stored credentials, so they must
  // be persisted before the browser round-trip starts.
  await saveSettings()

  // The backend owns the URL so its PKCE challenge, scopes and redirect URI
  // match exactly what the callback sends to the token endpoint.
  let url: string
  try {
    const authUrl = await invoke<{ success?: boolean; url?: string; message?: string }>(
      'get_oauth_authorize_url'
    )
    if (!authUrl?.url) throw new Error(authUrl?.message || 'No sign-in URL returned.')
    url = authUrl.url
  } catch (error) {
    microsoftConnectFailed.value = true
    microsoftConnectMessage.value =
      error instanceof Error ? error.message : 'Could not start Microsoft sign-in.'
    return
  }

  isConnectingMicrosoft.value = true
  microsoftConnectMessage.value = 'Complete sign-in in your browser…'

  try {
    await invoke('open_external_url', { url })

    for (let attempt = 0; attempt < 300; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1000))

      let status: OAuthStatus | null = null
      try {
        status = await invoke<OAuthStatus>('get_oauth_status', { clear: false })
      } catch {
        continue
      }

      if (status?.success) {
        await invoke('get_oauth_status', { clear: true })
        microsoftConnected.value = true
        formData.value.microsoft.connected = true
        await refreshMicrosoftConnection()
        microsoftConnectMessage.value = '✅ Microsoft account connected.'
        uiStore.showSuccess('✅ Microsoft account connected')
        return
      }

      if (status?.failed) {
        await invoke('get_oauth_status', { clear: true })
        microsoftConnectFailed.value = true
        microsoftConnectMessage.value = status.message || 'Microsoft sign-in failed.'
        return
      }
    }

    microsoftConnectFailed.value = true
    microsoftConnectMessage.value = 'Microsoft sign-in timed out. Please try again.'
  } catch (error) {
    microsoftConnectFailed.value = true
    microsoftConnectMessage.value =
      'Could not start sign-in: ' + (error instanceof Error ? error.message : String(error))
  } finally {
    isConnectingMicrosoft.value = false
  }
}

const saveSettings = async () => {
  isSaving.value = true
  try {
    await configStore.saveConfig({
      jira: formData.value.jira,
      microsoft: formData.value.microsoft,
      ollama: formData.value.ollama,
      oneNote: formData.value.oneNote,
      calendar: formData.value.calendar,
      autoStart: formData.value.autoStart,
      startMinimized: formData.value.startMinimized,
      lunch: formData.value.lunch,
      workday: formData.value.workday,
      notifications: {
        enabled: formData.value.notifications.enabled,
        submissionAlerts: formData.value.notifications.submissionAlerts,
        tempoReminder: { ...formData.value.notifications.tempoReminder }
      }
    })

    await saveSprintConfig()
    // Update auto-start via Tauri ONLY if it changed
    if (formData.value.autoStart !== originalData.value?.autoStart) {
      try {
        if (formData.value.autoStart) {
          await invoke('enable_autostart')
        } else {
          await invoke('disable_autostart')
        }
      } catch (autostartErr) {
        console.error('Autostart setup failed (non-fatal):', autostartErr)
        // Don't fail the whole save for autostart issues
      }
    }

    // Store notification preferences in localStorage
    localStorage.setItem('notificationSettings', JSON.stringify(formData.value.notifications))
    localStorage.setItem('autoStart', String(formData.value.autoStart))
    localStorage.setItem('startMinimized', String(formData.value.startMinimized))
    localStorage.setItem('theme', formData.value.theme)

    // Only re-arm when the schedule itself changed. Resetting on every save
    // would re-fire a reminder the user has already seen today, which is
    // exactly the kind of interruption this feature must avoid.
    const reminderChanged = JSON.stringify(originalData.value?.notifications?.tempoReminder)
      !== JSON.stringify(formData.value.notifications.tempoReminder)

    originalData.value = JSON.parse(JSON.stringify(formData.value))
    uiStore.showSuccess('✅ Settings saved successfully')

    if (reminderChanged) void refreshTempoReminder()

    // Pick up calendar changes immediately rather than waiting for a restart.
    if (formData.value.calendar.enabled && formData.value.calendar.syncOnStartup) {
      const result = await entriesStore.syncCalendar(entriesStore.selectedDate, { silent: true })
      if (result?.created) uiStore.showInfo(result.message)
    }
  } catch (error) {
    console.error('Save error:', error)
    uiStore.showError('Failed to save settings: ' + (error instanceof Error ? error.message : String(error)))
  } finally {
    isSaving.value = false
  }
}

onMounted(async () => {
  void refreshMicrosoftConnection()
  void loadSprintConfig()
  try {
    await configStore.loadConfigFromBackend()
    
    if (configStore.config.jira) {
      formData.value.jira = {
        baseUrl: configStore.config.jira.baseUrl || '',
        email: configStore.config.jira.email || '',
        apiToken: configStore.config.jira.apiToken || '',
        tempoToken: configStore.config.jira.tempoToken || '',
        defaultIssueMapping: configStore.config.jira.defaultIssueMapping || ''
      }
    }

    if (configStore.config.microsoft) {
      formData.value.microsoft = {
        tenantId: configStore.config.microsoft.tenantId || '',
        clientId: configStore.config.microsoft.clientId || '',
        clientSecret: configStore.config.microsoft.clientSecret || '',
        oauthUrl: '',
        connected: configStore.config.microsoft.connected || false,
        enabled: true
      }
    }

    if (configStore.config.ollama) {
      formData.value.ollama = {
        host: configStore.config.ollama.host || 'http://localhost:11434',
        model: configStore.config.ollama.model || 'llama3.2:1b',
        enabled: configStore.config.ollama.enabled || false,
        temperature: configStore.config.ollama.temperature ?? 0.7,
        maxTokens: configStore.config.ollama.maxTokens ?? 256
      }
    }

    if (configStore.config.notifications) {
      const saved = configStore.config.notifications
      formData.value.notifications = {
        ...formData.value.notifications,
        enabled: saved.enabled !== false,
        submissionAlerts: saved.submissionAlerts !== false,
        tempoReminder: {
          enabled: saved.tempoReminder?.enabled === true,
          time: saved.tempoReminder?.time || '16:30',
          days: saved.tempoReminder?.days === 'everyday' ? 'everyday' : 'weekdays'
        }
      }
    }

    if (configStore.config.oneNote) {
      formData.value.oneNote = {
        notebookId: configStore.config.oneNote.notebookId || '',
        notebookName: configStore.config.oneNote.notebookName || '',
        sectionId: configStore.config.oneNote.sectionId || '',
        sectionName: configStore.config.oneNote.sectionName || '',
        ticketSectionId: configStore.config.oneNote.ticketSectionId || '',
        ticketSectionName: configStore.config.oneNote.ticketSectionName || '',
        syncEnabled: configStore.config.oneNote.syncEnabled || false
      }
    }

    if (configStore.config.calendar) {
      formData.value.calendar = {
        includeAllDayEvents: configStore.config.calendar.includeAllDayEvents === true,
        filterLabel: configStore.config.calendar.filterLabel || '',
        enabled: configStore.config.calendar.enabled !== false,
        refreshInterval: configStore.config.calendar.refreshInterval || '30',
        syncOnStartup: configStore.config.calendar.syncOnStartup !== false
      }
    }

    formData.value.autoStart = configStore.config.autoStart || false
    formData.value.startMinimized = configStore.config.startMinimized || false

    // Populate the picker so an already-chosen notebook shows its name.
    if (formData.value.oneNote.notebookId || formData.value.oneNote.syncEnabled) {
      loadNotebooks()
    }
    if (configStore.config.lunch) {
      formData.value.lunch = { ...configStore.config.lunch }
    }
    if (configStore.config.workday) {
      formData.value.workday = { ...configStore.config.workday }
    }

    // Legacy fallback: notifications used to live only in localStorage.
    // The database is now authoritative, so merge only the legacy scalar
    // fields and never let this clobber the schedule loaded above.
    const notificationSettingsStr = localStorage.getItem('notificationSettings')
    if (notificationSettingsStr && !configStore.config.notifications) {
      try {
        const legacy = JSON.parse(notificationSettingsStr)
        formData.value.notifications = {
          ...formData.value.notifications,
          enabled: legacy.enabled !== false,
          submissionAlerts: legacy.submissionAlerts !== false,
          dailyReminders: legacy.dailyReminders === true,
          dailyReminderTime: legacy.dailyReminderTime || formData.value.notifications.dailyReminderTime
        }
      } catch (e) {
        console.error('Failed to parse notification settings:', e)
      }
    }

    // Load theme preference
    const theme = localStorage.getItem('theme')
    if (theme) {
      formData.value.theme = theme
    }

    // Try to get database path from backend
    try {
      const dbInfo = await invoke<{ path: string; size: string }>('get_database_info', {})
      if (dbInfo) {
        databasePath.value = dbInfo.path
        databaseSize.value = dbInfo.size
      }
    } catch (e) {
      console.warn('Could not fetch database info:', e)
    }

    originalData.value = JSON.parse(JSON.stringify(formData.value))
  } catch (error) {
    console.error('Failed to load settings:', error)
  }
})
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

.settings-page {
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
}

.page-header h1 {
  font-size: 1.8rem;
  font-weight: 700;
}

.btn-save {
  padding: 0.75rem 1.5rem;
  background: linear-gradient(135deg, #06b6d4, #0891b2);
  color: #0f172a;
  border: none;
  border-radius: 0.5rem;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.3s ease;
  font-size: 0.95rem;
}

.btn-save:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 8px 16px rgba(6, 182, 212, 0.3);
}

.btn-save:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Content */
.settings-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* Tabs */
.settings-tabs {
  width: 200px;
  background: rgba(20, 30, 50, 0.8);
  border-right: 1px solid rgba(148, 163, 184, 0.1);
  display: flex;
  flex-direction: column;
  padding: 1rem 0;
  overflow-y: auto;
}

.tab-button {
  padding: 1rem;
  background: transparent;
  border: none;
  color: #cbd5e1;
  cursor: pointer;
  text-align: left;
  font-weight: 500;
  font-size: 0.95rem;
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  white-space: nowrap;
}

.tab-button:hover {
  background: rgba(51, 65, 85, 0.5);
  color: #e2e8f0;
}

.tab-button.active {
  background: rgba(6, 182, 212, 0.2);
  color: #06b6d4;
  border-bottom: 2px solid #06b6d4;
  padding-bottom: calc(1rem - 2px);
}

/* Tab Content */
.tab-content {
  flex: 1;
  overflow-y: auto;
  padding: 2rem 3rem;
  max-width: 700px;
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.settings-section h2 {
  font-size: 1.5rem;
  font-weight: 700;
  margin-bottom: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
}

/* Form */
.settings-form {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

/* Current Sprint */
.section-intro {
  font-size: 0.875rem;
  color: #94a3b8;
  line-height: 1.5;
  margin: 0 0 1rem;
}

.settings-section h3 {
  font-size: 1.05rem;
  font-weight: 700;
  margin: 0.5rem 0 0.25rem;
  color: #e2e8f0;
}

.form-row {
  display: flex;
  gap: 1rem;
  align-items: flex-end;
}

.form-row .form-group {
  flex: 1;
}

.btn-lookup,
.btn-test {
  padding: 0.75rem 1.25rem;
  background: rgba(6, 182, 212, 0.15);
  border: 1px solid rgba(6, 182, 212, 0.4);
  border-radius: 0.5rem;
  color: #67e8f9;
  font-size: 0.9rem;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s ease;
  align-self: flex-start;
}

.btn-lookup:hover:not(:disabled),
.btn-test:hover:not(:disabled) {
  background: rgba(6, 182, 212, 0.25);
}

.btn-lookup:disabled,
.btn-test:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.lookup-msg.ok {
  color: #4ade80;
}

.lookup-msg.bad {
  color: #f87171;
}

.mapping-table {
  border: 1px solid rgba(148, 163, 184, 0.15);
  border-radius: 0.5rem;
  overflow: hidden;
}

.mapping-header,
.mapping-row {
  display: grid;
  grid-template-columns: 12rem 9rem 1fr;
  gap: 0.75rem;
  align-items: center;
  padding: 0.6rem 0.85rem;
}

.mapping-header {
  background: rgba(51, 65, 85, 0.5);
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #94a3b8;
}

.mapping-row + .mapping-row {
  border-top: 1px solid rgba(148, 163, 184, 0.08);
}

.mapping-label {
  font-weight: 600;
  font-size: 0.9rem;
  color: #cbd5e1;
}

.mapping-table input {
  width: 100%;
  padding: 0.45rem 0.6rem;
  background: rgba(51, 65, 85, 0.5);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.35rem;
  color: #e2e8f0;
  font-size: 0.875rem;
  font-family: inherit;
}

.mapping-table input:focus {
  outline: none;
  border-color: #06b6d4;
}

.mapping-ticket {
  font-family: 'Cascadia Code', Consolas, monospace;
}

.mapping-ticket.unset {
  border-color: rgba(248, 113, 113, 0.5);
}

.test-result {
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  font-size: 0.9rem;
}

.test-result.ok {
  background: rgba(34, 197, 94, 0.12);
  border: 1px solid rgba(34, 197, 94, 0.3);
  color: #86efac;
}

.test-result.bad {
  background: rgba(248, 113, 113, 0.12);
  border: 1px solid rgba(248, 113, 113, 0.3);
  color: #fca5a5;
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

.form-group input,
.form-group select {
  padding: 0.75rem;
  background: rgba(51, 65, 85, 0.5);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.5rem;
  color: #e2e8f0;
  font-size: 0.95rem;
  font-family: inherit;
  transition: all 0.3s ease;
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: #06b6d4;
  background: rgba(51, 65, 85, 0.8);
}

.form-group.checkbox {
  flex-direction: row;
  align-items: center;
  gap: 0.75rem;
}

.form-group.checkbox input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: #06b6d4;
  margin: 0;
  flex-shrink: 0;
}

.form-group.checkbox label {
  margin: 0;
  cursor: pointer;
  flex: 1;
}

.form-hint {
  font-size: 0.85rem;
  color: #94a3b8;
  line-height: 1.5;
  background: rgba(6, 182, 212, 0.1);
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  border-bottom: 2px solid #06b6d4;
  padding-bottom: calc(0.75rem - 2px);
}

.input-with-button {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.input-with-button select {
  flex: 1;
  min-width: 0;
}

.input-with-button button {
  flex-shrink: 0;
  white-space: nowrap;
}

.error-hint {
  background: rgba(239, 68, 68, 0.1);
  border-bottom-color: #ef4444;
  color: #fca5a5;
}

.account-connection {
  margin: 20px 0;
  padding: 16px;
  border: 1px solid rgba(148, 163, 184, 0.25);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.35);
}

.account-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #ef4444;
  flex-shrink: 0;
}

.status-dot.connected {
  background: #22c55e;
}

.account-hint {
  margin: 6px 0 12px;
  font-size: 0.85em;
  opacity: 0.75;
}

.account-warning {
  margin: 6px 0 12px;
  padding: 12px 14px;
  background: rgba(234, 179, 8, 0.1);
  border: 1px solid rgba(234, 179, 8, 0.35);
  border-radius: 8px;
  font-size: 0.85em;
  line-height: 1.5;
}

.account-warning ul {
  margin: 8px 0;
  padding-left: 20px;
}

.account-warning p {
  margin: 8px 0 0;
}

.account-warning code {
  padding: 1px 5px;
  background: rgba(15, 23, 42, 0.55);
  border-radius: 4px;
}

.field-hint {
  margin: 6px 0 0;
  font-size: 0.85em;
  opacity: 0.75;
}

.account-message {
  margin: 10px 0 0;
  font-size: 0.85em;
  color: #22c55e;
}

.account-message.error {
  color: #fca5a5;
}

.form-hint a {
  color: #06b6d4;
  text-decoration: none;
  font-weight: 600;
  transition: color 0.3s ease;
}

.form-hint a:hover {
  text-decoration: underline;
  color: #0891b2;
}

/* Info Box */
.info-box {
  display: flex;
  gap: 1rem;
  padding: 1rem;
  background: rgba(6, 182, 212, 0.1);
  border: 1px solid rgba(6, 182, 212, 0.2);
  border-radius: 0.5rem;
  border-bottom: 2px solid #06b6d4;
  padding-bottom: calc(1rem - 2px);
}

.info-icon {
  font-size: 1.5rem;
  flex-shrink: 0;
}

.info-box p {
  margin: 0;
  font-size: 0.9rem;
  color: #cbd5e1;
  line-height: 1.5;
}

.info-box p:first-child {
  margin-bottom: 0.5rem;
}

/* Status Group */
.status-group {
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 0.5rem;
  padding: 1rem;
}

.status-group h3 {
  font-size: 1rem;
  font-weight: 700;
  margin-bottom: 1rem;
  color: #e2e8f0;
}

.status-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
}

.status-item:last-child {
  border-bottom: none;
}

.status-label {
  font-weight: 500;
  color: #cbd5e1;
}

.status-badge {
  padding: 0.25rem 0.75rem;
  border-radius: 0.25rem;
  font-size: 0.85rem;
  font-weight: 600;
}

.status-badge.connected {
  background: rgba(16, 185, 129, 0.2);
  color: #10b981;
}

.status-badge.disconnected {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.status-value {
  color: #94a3b8;
  font-family: 'Space Mono', monospace;
  font-size: 0.85rem;
}

/* Buttons */
.btn-secondary {
  padding: 0.75rem 1.5rem;
  background: rgba(51, 65, 85, 0.5);
  border: 1px solid rgba(148, 163, 184, 0.2);
  color: #cbd5e1;
  border-radius: 0.5rem;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.3s ease;
  font-size: 0.95rem;
  align-self: flex-start;
}

.btn-secondary:hover {
  background: rgba(51, 65, 85, 0.8);
  border-color: rgba(148, 163, 184, 0.4);
  color: #e2e8f0;
}

.button-group {
  display: flex;
  gap: 1rem;
}

/* Sliders */
.slider {
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: rgba(51, 65, 85, 0.5);
  outline: none;
  -webkit-appearance: none;
  appearance: none;
  cursor: pointer;
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #06b6d4;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 4px rgba(6, 182, 212, 0.3);
}

.slider::-webkit-slider-thumb:hover {
  background: #0891b2;
  box-shadow: 0 4px 8px rgba(6, 182, 212, 0.5);
  transform: scale(1.1);
}

.slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #06b6d4;
  cursor: pointer;
  border: none;
  transition: all 0.2s ease;
  box-shadow: 0 2px 4px rgba(6, 182, 212, 0.3);
}

.slider::-moz-range-thumb:hover {
  background: #0891b2;
  box-shadow: 0 4px 8px rgba(6, 182, 212, 0.5);
  transform: scale(1.1);
}

.slider::-moz-range-track {
  background: transparent;
  border: none;
}

.slider::-moz-range-progress {
  background: rgba(6, 182, 212, 0.3);
  height: 6px;
  border-radius: 3px;
}

.slider-labels {
  display: flex;
  justify-content: space-between;
  font-size: 0.8rem;
  color: #94a3b8;
  margin-top: 0.25rem;
}

/* Status Display */
.status-display {
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 0.5rem;
  padding: 1rem;
  margin-bottom: 1rem;
}

.status-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 0;
}

.status-label {
  font-weight: 500;
  color: #cbd5e1;
}

.status-badge {
  padding: 0.25rem 0.75rem;
  border-radius: 0.25rem;
  font-size: 0.85rem;
  font-weight: 600;
}

.status-badge.connected {
  background: rgba(16, 185, 129, 0.2);
  color: #10b981;
}

.status-badge.disconnected {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

/* Form Hint Small */
.form-hint-small {
  font-size: 0.8rem;
  color: #94a3b8;
  display: block;
  margin-top: 0.25rem;
}

.form-hint-small.error-text {
  color: #ef4444;
}

.model-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.model-row select {
  flex: 1;
}

.model-row .btn-secondary {
  white-space: nowrap;
}

/* Info Box Variants */
.info-box {
  display: flex;
  gap: 1rem;
  padding: 1rem;
  background: rgba(6, 182, 212, 0.1);
  border: 1px solid rgba(6, 182, 212, 0.2);
  border-radius: 0.5rem;
  border-bottom: 2px solid #06b6d4;
  padding-bottom: calc(1rem - 2px);
}

.info-box.warning {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.2);
  border-bottom-color: #ef4444;
}

.info-box.success {
  background: rgba(16, 185, 129, 0.1);
  border-color: rgba(16, 185, 129, 0.2);
  border-bottom-color: #10b981;
}

.info-box ol {
  margin: 0.5rem 0 0 1.5rem;
  padding: 0;
}

.info-box li {
  margin: 0.25rem 0;
  color: #cbd5e1;
}

.info-box code {
  background: rgba(0, 0, 0, 0.3);
  padding: 0.2rem 0.4rem;
  border-radius: 0.25rem;
  font-family: 'Space Mono', monospace;
  font-size: 0.85rem;
}

/* Readonly Field */
.readonly-field {
  padding: 0.75rem;
  background: rgba(30, 41, 59, 0.5);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.5rem;
  color: #94a3b8;
  font-family: 'Space Mono', monospace;
  font-size: 0.9rem;
}

/* About Card */
.about-card {
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 0.5rem;
  padding: 1.5rem;
  margin-bottom: 1rem;
}

.about-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
}

.about-item:last-child {
  border-bottom: none;
}

.about-label {
  font-weight: 600;
  color: #cbd5e1;
}

.about-value {
  color: #94a3b8;
  font-family: 'Space Mono', monospace;
  font-size: 0.9rem;
}

/* Button Danger */
.btn-danger {
  padding: 0.75rem 1.5rem;
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.5);
  color: #fca5a5;
  border-radius: 0.5rem;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.3s ease;
  font-size: 0.95rem;
  align-self: flex-start;
}

.btn-danger:hover {
  background: rgba(239, 68, 68, 0.25);
  border-color: rgba(239, 68, 68, 0.7);
  color: #ef4444;
}

.btn-danger:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Scrollbar */
.settings-tabs::-webkit-scrollbar,
.tab-content::-webkit-scrollbar {
  width: 6px;
}

.settings-tabs::-webkit-scrollbar-track,
.tab-content::-webkit-scrollbar-track {
  background: transparent;
}

.settings-tabs::-webkit-scrollbar-thumb,
.tab-content::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.2);
  border-radius: 3px;
}

.settings-tabs::-webkit-scrollbar-thumb:hover,
.tab-content::-webkit-scrollbar-thumb:hover {
  background: rgba(148, 163, 184, 0.4);
}

/* Responsive */
@media (max-width: 1024px) {
  .tab-content {
    padding: 1.5rem;
  }

  .settings-tabs {
    width: 150px;
  }

  .tab-button {
    padding: 0.75rem;
    font-size: 0.85rem;
  }
}

@media (max-width: 768px) {
  .settings-content {
    flex-direction: column;
  }

  .settings-tabs {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid rgba(148, 163, 184, 0.1);
    height: auto;
    flex-direction: row;
    overflow-x: auto;
    padding: 0.5rem 1rem;
  }

  .tab-button {
    padding: 0.5rem 1rem;
    flex-shrink: 0;
  }

  .tab-button.active {
    border-right: none;
    border-bottom: 3px solid #06b6d4;
    padding-right: 1rem;
    padding-bottom: calc(0.5rem - 3px);
  }

  .page-header {
    flex-direction: column;
    gap: 1rem;
    align-items: flex-start;
    padding: 1.5rem;
  }

  .tab-content {
    padding: 1.5rem;
    max-width: none;
  }
}
</style>
