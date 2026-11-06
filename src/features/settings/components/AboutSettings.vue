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
          <option value="main">Main</option>
          <option value="beta">Beta</option>
        </select>
        <p class="form-hint">
          Beta gets new features first, but may have more bugs. Moving from Beta to Main never
          installs an older version: you keep this build until Main has a newer one.
        </p>
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
import { effectiveUpdateChannel } from '@/features/updates/composables/useUpdater'
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

// Saved straight away, so it applies to the next check without the Settings save button.
const changeChannel = async (event: Event) => {
  const select = event.target as HTMLSelectElement
  isSavingChannel.value = true
  try {
    await configStore.saveConfig({ updateChannel: select.value as UpdateChannel })
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
