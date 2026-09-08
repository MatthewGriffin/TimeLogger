<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useRouter, useRoute } from 'vue-router'
import Navigation from './components/Navigation.vue'
import NotificationCenter from './components/NotificationCenter.vue'
import AiModelPrompt from './components/AiModelPrompt.vue'
import { startTempoReminderScheduler, stopTempoReminderScheduler } from './composables/useTempoReminder'
import { useAppStore } from './stores/app'
import { useUiStore } from './stores/ui'

const appStore = useAppStore()
const uiStore = useUiStore()
const router = useRouter()
const route = useRoute()
const aiModelPrompt = ref<InstanceType<typeof AiModelPrompt> | null>(null)
let unlistenTrayNavigate: (() => void) | undefined

const waitForBackend = async () => {
  // Health polling goes through Rust for the same reason API calls do: the
  // webview origin cannot reliably reach 127.0.0.1 in the packaged app.
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if (await invoke<boolean>('backend_health')) return
    } catch {
      // Treat probe errors as "not ready yet" and keep polling.
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('The TimeLogger backend did not start. Check that Node.js is installed and see backend_output.log.')
}

onMounted(async () => {
  try {
    await invoke<string>('start_backend')
    await waitForBackend()
    await appStore.initializeApp()
    if (appStore.startupError) uiStore.reportError(appStore.startupError, 'Failed to initialize application')
  } catch (error) {
    uiStore.reportError(error, 'Failed to initialize application')
  }

  // Checked last and never awaited into the startup path: an optional model
  // download must not delay the app becoming usable, or fail its startup.
  void aiModelPrompt.value?.check()

  startTempoReminderScheduler()

  // Tray menu "Add Task" / "Add Note" / "Submit Time" navigate here. For the
  // first two, a same-named DOM event then tells the destination page to
  // focus its input. A DOM event (rather than only relying on the route
  // change) still fires even when the user is already on that page, since a
  // query-only navigation does not remount it.
  unlistenTrayNavigate = await listen<string>('tray-navigate', async (event) => {
    const target = event.payload
    const routeFor: Record<string, string> = {
      'add-task': '/entries',
      'add-note': '/notes',
      'submit-time': '/submit'
    }
    const path = routeFor[target]
    if (!path) return
    if (route.path !== path) await router.push(path)

    const focus = target === 'add-task' ? 'task' : target === 'add-note' ? 'note' : null
    if (focus) window.dispatchEvent(new CustomEvent('timelogger:focus-request', { detail: focus }))
  })
})

onUnmounted(() => {
  stopTempoReminderScheduler()
  unlistenTrayNavigate?.()
})

window.addEventListener('beforeunload', async () => {
  try {
    await invoke('stop_backend')
  } catch {
    // Best-effort shutdown only.
  }
})

// Global notification functions accessible from other components
window.showNotification = async (title: string, message: string) => {
  try {
    await invoke('show_notification', { title, message })
  } catch (error) {
    console.error('Failed to show notification:', error)
  }
}

window.showSubmissionSuccess = async (date: string) => {
  try {
    await invoke('show_submission_success_notification', { submissionDate: date })
  } catch (error) {
    console.error('Failed to show notification:', error)
  }
}

window.showSubmissionError = async (error: string) => {
  try {
    await invoke('show_submission_error_notification', { error })
  } catch (error) {
    console.error('Failed to show notification:', error)
  }
}

window.showDailyReminder = async (taskCount: number) => {
  try {
    await invoke('show_daily_reminder_notification', { taskCount })
  } catch (error) {
    console.error('Failed to show notification:', error)
  }
}

// Declare global properties for TypeScript
declare global {
  interface Window {
    showNotification: (title: string, message: string) => Promise<void>
    showSubmissionSuccess: (date: string) => Promise<void>
    showSubmissionError: (error: string) => Promise<void>
    showDailyReminder: (taskCount: number) => Promise<void>
  }
}
</script>

<template>
  <main class="app-shell">
    <div class="app-layout">
      <Navigation />
      <div class="app-content">
        <router-view />
      </div>
      <NotificationCenter />
      <AiModelPrompt ref="aiModelPrompt" />
    </div>
  </main>
</template>

<style>
.app-shell {
  min-height: 100vh;
  width: 100%;
}

.app-layout {
  display: flex;
  min-height: 100vh;
  background: linear-gradient(135deg, #0f172a 0%, #1a1f3a 100%);
}

.app-content {
  flex: 1;
  /* Without this a wide child (tables, code) sets the flex base size and the
     content column refuses to shrink, so collapsing the nav frees no space. */
  min-width: 0;
  overflow-y: auto;
}
</style>
