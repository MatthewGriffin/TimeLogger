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
const startupReady = ref(false)
const startupFailure = ref('')
const startupPromise = appStore.initializeApp()
void startupPromise.catch(error => {
  startupFailure.value = error instanceof Error ? error.message : 'Failed to start the TimeLogger backend.'
  uiStore.reportError(error, 'Failed to initialize application')
}).finally(() => {
  startupReady.value = true
})
let unlistenTrayNavigate: (() => void) | undefined
let githubPollingTimer: ReturnType<typeof setInterval> | undefined
let githubPollInFlight = false

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
      const outcome = event.kind === 'added'
        ? 'added you to'
        : event.kind === 'merged'
          ? 'merged'
          : event.kind === 'approval'
            ? 'approved'
            : event.kind === 'inline-comment'
              ? 'left an inline review comment on'
              : event.kind === 'discussion-comment'
                ? 'left a comment on'
                : event.outcome === 'CHANGES_REQUESTED'
                  ? 'requested changes on'
                  : 'left review feedback on'
      const message = event.kind === 'added'
        ? `You were added to “${event.title}” (${event.repository}#${event.number}).`
        : event.kind === 'merged'
          ? `“${event.title}” (${event.repository}#${event.number}) was merged.`
          : `@${event.reviewer} ${outcome} “${event.title}” (${event.repository}#${event.number}).`
      uiStore.addNotification({ type: 'info', message, url: event.url })
      try {
        await invoke('show_notification', {
          title: event.kind === 'added'
            ? 'Added to GitHub PR'
            : event.kind === 'merged'
              ? 'GitHub PR merged'
              : event.kind === 'approval'
                ? 'GitHub PR approved'
                : event.kind.includes('comment')
                  ? 'GitHub PR comment'
                  : 'GitHub review activity',
          message,
          url: event.url
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
    await startupPromise
    if (appStore.startupError) uiStore.reportError(appStore.startupError, 'Failed to initialize application')
  } catch {
    // The startup promise already reports its error and exposes it in the app.
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
        <div v-if="!startupReady" class="startup-state" role="status" aria-live="polite">
          <span class="startup-spinner" aria-hidden="true"></span>
          Starting TimeLogger…
        </div>
        <div v-else-if="startupFailure" class="startup-state startup-failed" role="alert">
          <h1>TimeLogger couldn't start</h1>
          <p>{{ startupFailure }}</p>
          <p>Check the backend log, then restart the app.</p>
        </div>
        <router-view v-else />
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

.startup-state {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: .75rem;
  padding: 2rem;
  color: var(--color-text-muted);
  text-align: center;
}

.startup-state h1 {
  margin: 0;
  color: var(--color-text);
  font-size: 1.35rem;
}

.startup-state p { margin: 0; max-width: 42rem; }
.startup-failed { color: var(--color-danger); }

.startup-spinner {
  width: 1.5rem;
  height: 1.5rem;
  border: 3px solid var(--color-border);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: startup-spin .8s linear infinite;
}

@keyframes startup-spin { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  .startup-spinner { animation: none; }
}
</style>
