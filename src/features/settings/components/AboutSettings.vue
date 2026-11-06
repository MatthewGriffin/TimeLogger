<template>
  <div class="settings-section">
    <h2>About TimeLogger</h2>
    <div class="settings-form">
      <div class="about-card">
        <div class="about-item">
          <span class="about-label">Application Version</span>
          <span class="about-value">v{{ appVersion }}</span>
        </div>
        <div class="about-item">
          <span class="about-label">Build Date</span>
          <span class="about-value">{{ buildDate }}</span>
        </div>
        <div class="about-item">
          <span class="about-label">Tauri Version</span>
          <span class="about-value">{{ tauriVersion }}</span>
        </div>
      </div>

      <div class="form-group">
        <label for="update-channel">Update Channel</label>
        <select id="update-channel" :value="channel" :disabled="isSavingChannel" @change="changeChannel">
          <option value="main">Stable</option>
          <option value="beta">Beta</option>
        </select>
        <p class="form-hint">
          Beta gets new features first, but may have more bugs. Choosing Stable on a beta build
          offers the latest stable release, and nothing installs until you accept it.
        </p>
      </div>

      <div class="form-group">
        <label for="rollback-version">Roll Back</label>
        <p class="form-hint">
          If a new version breaks something, go back to an earlier one until there's a fix.
        </p>
        <button
          v-if="!rollbackVersions"
          type="button"
          class="btn-secondary"
          :disabled="isLoadingRollback"
          @click="loadRollbackVersions"
        >
          {{ isLoadingRollback ? 'Loading versions…' : '↩️ Choose a previous version' }}
        </button>
        <p v-else-if="!rollbackVersions.length" class="form-hint">There are no earlier versions to roll back to.</p>
        <div v-else class="rollback-row">
          <select id="rollback-version" v-model="rollbackVersion">
            <option v-for="choice in rollbackVersions" :key="choice.version" :value="choice.version">
              {{ choice.version }}{{ choice.releaseDate ? ` (${formatDate(choice.releaseDate)})` : '' }}
            </option>
          </select>
          <button type="button" class="btn-secondary" @click="prepareRollback(rollbackVersion)">Roll back</button>
        </div>
      </div>

      <div class="button-group" style="flex-direction: column; gap: 0.75rem;">
        <button type="button" class="btn-secondary" @click="$emit('check-updates')">🔄 Check for Updates</button>
        <button type="button" class="btn-secondary" @click="$emit('open-documentation')">📖 View Documentation</button>
        <button type="button" class="btn-secondary" @click="$emit('report-issue')">🐛 Report Issue</button>
      </div>

      <div class="info-box">
        <span class="info-icon">ℹ️</span>
        <div>
          <p><strong>TimeLogger</strong> - A simple and elegant time tracking application</p>
          <p>Built with Vue 3, Tauri, Vite, and TypeScript for maximum performance and reliability.</p>
          <p><strong>Features:</strong> Jira integration, Tempo tracking, Microsoft Graph, Ollama AI, OneNote sync, and more.</p>
        </div>
      </div>
      <div class="info-box">
        <span class="info-icon">📜</span>
        <div>
          <p><strong>License:</strong> MIT License</p>
          <p>This project is open source and available on GitHub.</p>
        </div>
      </div>
      <div class="form-hint">💡 Thank you for using TimeLogger! We're continuously improving the app based on your feedback.</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { getVersion, getTauriVersion } from '@tauri-apps/api/app'
import { effectiveUpdateChannel, useUpdater } from '@/features/updates/composables/useUpdater'
import type { RollbackVersion } from '@/features/updates/models/updater'
import { useConfigStore } from '@/shared/stores/config'
import { useUiStore } from '@/shared/stores/ui'
import type { UpdateChannel } from '@/shared/models/config'

defineProps<{ buildDate: string }>()
defineEmits<{
  'check-updates': []
  'open-documentation': []
  'report-issue': []
}>()

const appVersion = ref('…')
const tauriVersion = ref('…')

const configStore = useConfigStore()
const uiStore = useUiStore()
const isSavingChannel = ref(false)
const channel = computed(() => effectiveUpdateChannel(configStore.config.updateChannel, appVersion.value))
const { checkForUpdate, listRollbackVersions, prepareRollback } = useUpdater()

const rollbackVersions = ref<RollbackVersion[] | null>(null)
const rollbackVersion = ref('')
const isLoadingRollback = ref(false)

const formatDate = (date: string) => new Date(date).toLocaleDateString()

// Loaded on request, so opening Settings doesn't use up GitHub's request limit.
const loadRollbackVersions = async () => {
  isLoadingRollback.value = true
  try {
    rollbackVersions.value = await listRollbackVersions()
    rollbackVersion.value = rollbackVersions.value[0]?.version ?? ''
  } catch (error) {
    uiStore.showError(`Could not load earlier versions: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    isLoadingRollback.value = false
  }
}

// Saved straight away, so it applies to the next check without the Settings save
// button. Checking now updates the sidebar button to suit the new channel.
const changeChannel = async (event: Event) => {
  const select = event.target as HTMLSelectElement
  isSavingChannel.value = true
  try {
    await configStore.saveUpdateChannel(select.value as UpdateChannel)
    rollbackVersions.value = null
    void checkForUpdate(true)
  } catch (error) {
    select.value = channel.value
    uiStore.showError(error instanceof Error ? error.message : 'Could not save the update channel')
  } finally {
    isSavingChannel.value = false
  }
}

onMounted(async () => {
  try {
    appVersion.value = await getVersion()
    tauriVersion.value = await getTauriVersion()
  } catch {
    appVersion.value = 'unknown'
    tauriVersion.value = 'unknown'
  }
})
</script>

<style scoped>
.rollback-row {
  display: flex;
  gap: 0.75rem;
  align-items: center;
}

.rollback-row select {
  flex: 1;
  min-width: 0;
}

/* About Card */
.about-card {
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
  padding: 1.5rem;
  margin-bottom: 1rem;
}

.about-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--color-border);
}

.about-item:last-child {
  border-bottom: none;
}

.about-label {
  font-weight: 600;
  color: var(--color-text-muted);
}

.about-value {
  color: var(--color-text-subtle);
  font-family: 'Space Mono', monospace;
  font-size: 0.9rem;
}
</style>
