<template>
  <div class="settings-page page-shell">
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

        <ConfirmDangerDialog
          :open="showClearConfirm"
          title="Clear all data?"
          @confirm="confirmClearAllData"
          @cancel="showClearConfirm = false"
        >
          This permanently deletes every time entry, note and submission record
          on this machine. Your settings and sign-ins are kept. This cannot be
          undone — export a backup first if you have not already.
        </ConfirmDangerDialog>

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
import { executeApi, asList } from '@/shared/utils/api'
import { asRecord, asString, asBoolean } from '@/shared/utils/schema'
import { useConfigStore } from '@/shared/stores/config'
import { useEntriesStore } from '@/shared/stores/entries'
import { useUiStore } from '@/shared/stores/ui'
import { refreshTempoReminder } from '@/features/tempo/services/tempo-reminder'
import { useUpdater } from '@/features/updates/composables/useUpdater'
import { useDataManagement } from '@/features/settings/composables/useDataManagement'
import ConfirmDangerDialog from '@/shared/components/ConfirmDangerDialog.vue'
import CalendarSettings from '@/features/settings/components/CalendarSettings.vue'
import AboutSettings from '@/features/settings/components/AboutSettings.vue'
import CurrentSprintSettings from '@/features/settings/components/CurrentSprintSettings.vue'
import DatabaseSettings from '@/features/settings/components/DatabaseSettings.vue'
import AppSettings from '@/features/settings/components/AppSettings.vue'
import JiraTempoSettings from '@/features/settings/components/JiraTempoSettings.vue'
import MicrosoftSettings from '@/features/settings/components/MicrosoftSettings.vue'
import OneNoteSettings from '@/features/settings/components/OneNoteSettings.vue'
import OllamaSettings from '@/features/settings/components/OllamaSettings.vue'
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
} from '@/features/settings/models/settings'

const configStore = useConfigStore()
const entriesStore = useEntriesStore()
const uiStore = useUiStore()
const updater = useUpdater()
const dataManagement = useDataManagement()

const tabs: SettingsTabName[] = ['Jira & Tempo', 'Current Sprint', 'Microsoft', 'OneNote', 'Calendar', 'Ollama', 'App Settings', 'Database & Data', 'About']
const activeTab = ref<SettingsTabName>('Jira & Tempo')
const isSaving = ref(false)
const databasePath = ref('Loading…')
const databaseSize = ref('Loading…')

const loadDatabaseInfo = async () => {
  try {
    const info = await dataManagement.getDatabaseInfo()
    databasePath.value = info.path
    databaseSize.value = info.size
  } catch {
    // Nothing here is actionable for the user, so show the failure in place
    // rather than as a toast on every visit to Settings.
    databasePath.value = 'Unavailable'
    databaseSize.value = 'Unavailable'
  }
}
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

const exportDataAsJson = async () => {
  try {
    const path = await dataManagement.exportData('json')
    // A cancelled dialog is a decision, not a failure - say nothing.
    if (path) uiStore.showSuccess(`Backup saved to ${path}`)
  } catch (error) {
    uiStore.reportError(error, 'Export failed')
  }
}

const exportDataAsCsv = async () => {
  try {
    const path = await dataManagement.exportData('csv')
    if (path) uiStore.showSuccess(`Entries exported to ${path}`)
  } catch (error) {
    uiStore.reportError(error, 'Export failed')
  }
}

const importData = async () => {
  try {
    const result = await dataManagement.importData()
    if (!result) return
    if (result.total === 0) {
      uiStore.showInfo(
        result.duplicates > 0
          ? 'Everything in that backup is already here, so nothing was added.'
          : 'That backup contained no entries or notes.'
      )
    } else {
      uiStore.showSuccess(
        `Restored ${result.total} item${result.total === 1 ? '' : 's'}` +
        (result.duplicates > 0 ? `, skipping ${result.duplicates} already present.` : '.')
      )
    }
    // The pages that render this data hold their own copies, so refresh both
    // the counts shown here and the entries the rest of the app is showing.
    await Promise.all([loadDatabaseInfo(), entriesStore.loadEntriesFromBackend()])
  } catch (error) {
    uiStore.reportError(error, 'Import failed')
  }
}

const viewLogs = async () => {
  try {
    await dataManagement.openLogsFolder()
  } catch (error) {
    uiStore.reportError(error, 'Could not open the logs folder')
  }
}

const showClearConfirm = ref(false)

const clearAllData = () => {
  showClearConfirm.value = true
}

const confirmClearAllData = async () => {
  showClearConfirm.value = false
  try {
    const result = await dataManagement.clearAllData()
    uiStore.showSuccess(
      result.total === 0
        ? 'There was nothing left to clear.'
        : `Cleared ${result.total} item${result.total === 1 ? '' : 's'}.`
    )
    await Promise.all([loadDatabaseInfo(), entriesStore.loadEntriesFromBackend()])
  } catch (error) {
    uiStore.reportError(error, 'Could not clear data')
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

    // Real path and size, so the Database tab never shows invented numbers.
    await loadDatabaseInfo()

    originalData.value = JSON.parse(JSON.stringify(formData.value))
  } catch (error) {
    console.error('Failed to load settings:', error)
  }
})
</script>

<style scoped>

.btn-save {
  padding: 0.75rem 1.5rem;
  background: linear-gradient(135deg, var(--color-accent), var(--color-accent-strong));
  color: var(--color-on-accent);
  border: none;
  border-radius: 0.5rem;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.3s ease;
  font-size: 0.95rem;
}

.btn-save:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 8px 16px var(--color-accent-ring);
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
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  padding: 1rem 0;
  overflow-y: auto;
}

.tab-button {
  padding: 1rem;
  background: transparent;
  border: none;
  color: var(--color-text-muted);
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
  background: var(--color-control);
  color: var(--color-text);
}

.tab-button.active {
  background: var(--color-accent-muted);
  color: var(--color-accent);
  border-bottom: 2px solid var(--color-accent);
  padding-bottom: calc(1rem - 2px);
}

/* Tab Content */
.tab-content {
  flex: 1;
  overflow-y: auto;
  padding: 2rem 3rem;
  max-width: 700px;
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
  background: var(--color-border-strong);
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
</style>
