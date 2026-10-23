<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useRouter, useRoute } from 'vue-router'
import Navigation from '@/shared/components/Navigation.vue'
import NotificationCenter from '@/shared/components/NotificationCenter.vue'
import AiModelPrompt from '@/shared/components/AiModelPrompt.vue'
import UpdateDialog from '@/features/updates/UpdateDialog.vue'
import { startTempoReminderScheduler, stopTempoReminderScheduler } from '@/features/tempo/services/tempo-reminder'
import { checkForUpdateOnStartup } from '@/features/updates/composables/useUpdater'
import { useAppStore } from '@/shared/stores/app'
import { useUiStore } from '@/shared/stores/ui'
import { executeApi } from '@/shared/utils/api'

const appStore = useAppStore()
const uiStore = useUiStore()
const router = useRouter()
const route = useRoute()
const aiModelPrompt = ref<InstanceType<typeof AiModelPrompt> | null>(null)
let unlistenTrayNavigate: (() => void) | undefined
let githubPollingTimer: ReturnType<typeof setInterval> | undefined
let githubPollInFlight = false

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


/**
 * Check read-only GitHub review activity. The backend persists seen event IDs,
 * so repeated polling and app restarts do not repeat the same alert.
 */
const pollGitHubActivity = async () => {
  if (githubPollInFlight) return
  githubPollInFlight = true
  try {
    const result = await executeApi<{ events?: Array<{
      id: string
      kind: string
      reviewer: string
      outcome: string
      title: string
      url: string
      repository: string
      number: number
      body?: string
    }> }>('github_pr_poll_activity')
    for (const event of result.events || []) {
      const outcome = event.kind === 'approval'
        ? 'approved'
        : event.kind === 'inline-comment'
          ? 'left an inline review comment on'
          : event.kind === 'discussion-comment'
            ? 'left a comment on'
            : event.outcome === 'CHANGES_REQUESTED'
              ? 'requested changes on'
              : 'left review feedback on'
      const message = `@${event.reviewer} ${outcome} “${event.title}” (${event.repository}#${event.number}).`
      uiStore.addNotification({ type: 'info', message, duration: 0, url: event.url })
      try {
        await invoke('show_notification', {
          title: event.kind === 'approval' ? 'GitHub PR approved' : event.kind.includes('comment') ? 'GitHub PR comment' : 'GitHub review activity',
          message
        })
      } catch (error) {
        console.warn('Could not show GitHub review notification:', error)
      }
    }
  } catch {
    // GitHub is optional; do not interrupt normal app use when disconnected or
    // temporarily offline. The Settings tab exposes connection diagnostics.
  } finally {
    githubPollInFlight = false
  }
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
  // Review polling runs in the live app process (including when the window is
  // hidden to the tray). It does not run while the app is closed.
  void pollGitHubActivity()
  githubPollingTimer = setInterval(() => void pollGitHubActivity(), 120_000)

  // Same reasoning as the model prompt: never awaited, and silent unless
  // there is actually a new version to offer.
  checkForUpdateOnStartup()

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
  if (githubPollingTimer) clearInterval(githubPollingTimer)
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
  <div class="app-shell">
    <div class="app-layout">
      <Navigation />
      <!-- The content column is the main landmark. The shell cannot be, since
           it also contains the nav, and a navigation landmark nested inside
           main is not exposed as a sibling of it. -->
      <main class="app-content">
        <router-view />
      </main>
      <NotificationCenter />
      <AiModelPrompt ref="aiModelPrompt" />
      <UpdateDialog />
    </div>
  </div>
</template>

<style>
.app-shell {
  height: 100vh;
  width: 100%;
}

.app-layout {
  display: flex;
  height: 100vh;
  min-height: 0;
  overflow: hidden;
  background: linear-gradient(135deg, var(--color-surface) 0%, var(--color-surface-raised) 100%);
}

.app-content {
  flex: 1;
  /* Without this a wide child (tables, code) sets the flex base size and the
     content column refuses to shrink, so collapsing the nav frees no space. */
  min-width: 0;
  overflow-y: auto;
}
</style>
