<!--
  Shows a pending application update and installs it on request.

  Opens only when asked for, from the sidebar button or Settings, so a new
  version never interrupts someone's work. It's still a modal because once the
  download starts it must not be possible to lose the dialog behind the app and
  start a second one.
-->
<template>
  <transition name="update-dialog">
    <div v-if="visible" class="update-backdrop" @click.self="closeIfIdle">
      <div
        class="update-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-dialog-title"
      >
        <h2 id="update-dialog-title" class="update-title">
          <template v-if="stage === 'available' && info?.kind === 'switch'">Switch to stable</template>
          <template v-else-if="stage === 'available' && info?.kind === 'rollback'">Roll back</template>
          <template v-else-if="stage === 'available'">Update available</template>
          <template v-else-if="stage === 'downloading'">Downloading update…</template>
          <template v-else-if="stage === 'installing'">Installing…</template>
          <template v-else-if="stage === 'ready'">Update installed</template>
          <template v-else>Update failed</template>
        </h2>

        <template v-if="stage === 'available' && info">
          <p v-if="info.kind === 'switch'" class="update-text">
            You're on beta {{ info.currentVersion }}. The latest stable release is
            <strong>{{ info.version }}</strong>, which is older, so features added since then
            go away until stable catches up.
          </p>
          <p v-else-if="info.kind === 'rollback'" class="update-text">
            TimeLogger <strong>{{ info.version }}</strong> will replace {{ info.currentVersion }}.
            Features added since then go away until you update again.
          </p>
          <p v-else class="update-text">
            TimeLogger <strong>{{ info.version }}</strong> is ready to install.
            You are currently on {{ info.currentVersion }}.
          </p>
          <div v-if="info.changes.length" class="update-changes">
            <section v-for="note in info.changes" :key="note.version">
              <h3 class="update-version">What's new in {{ note.version }}</h3>
              <ul class="update-list">
                <li v-for="change in note.changes" :key="change">{{ change }}</li>
              </ul>
            </section>
          </div>
          <div v-else-if="info.notes" class="update-notes">{{ info.notes }}</div>
          <p class="update-hint">The app will close briefly while it updates.</p>
        </template>

        <template v-else-if="stage === 'downloading' || stage === 'installing'">
          <div
            class="update-bar"
            role="progressbar"
            :aria-valuenow="stage === 'downloading' ? progressPercent : undefined"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <div
              class="update-fill"
              :class="{ indeterminate: stage === 'installing' }"
              :style="stage === 'downloading' ? { transform: `scaleX(${progressPercent / 100})` } : undefined"
            ></div>
          </div>
          <p class="update-text">
            <template v-if="stage === 'downloading'">{{ progressPercent }}% — {{ downloadedLabel }}</template>
            <template v-else>Almost done. TimeLogger will restart when this finishes.</template>
          </p>
        </template>

        <template v-else-if="stage === 'ready'">
          <p class="update-text">
            TimeLogger {{ info?.version }} has been installed. Restart to start using it.
          </p>
        </template>

        <template v-else-if="stage === 'error'">
          <p class="update-text">{{ errorMessage }}</p>
          <p class="update-hint">
            You can also download the latest installer from the releases page.
          </p>
        </template>

        <div class="update-actions">
          <template v-if="stage === 'available'">
            <button type="button" class="update-secondary" @click="closeDialog">Later</button>
            <button type="button" class="update-primary" @click="downloadAndInstall">{{ installLabel }}</button>
          </template>
          <template v-else-if="stage === 'ready'">
            <button type="button" class="update-secondary" @click="closeDialog">Restart later</button>
            <button type="button" class="update-primary" @click="restartNow">Restart now</button>
          </template>
          <template v-else-if="stage === 'error'">
            <button type="button" class="update-secondary" @click="closeDialog">Close</button>
            <button type="button" class="update-primary" @click="retry">Try again</button>
          </template>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useUpdater } from '@/features/updates/composables/useUpdater'

const {
  stage,
  info,
  errorMessage,
  downloadedBytes,
  totalBytes,
  progressPercent,
  dialogOpen,
  closeDialog,
  checkForUpdate,
  downloadAndInstall,
  restartNow
} = useUpdater()

// 'checking' stays hidden so the silent startup check never flashes a dialog.
const visible = computed(() =>
  stage.value === 'available'
    ? dialogOpen.value
    : ['downloading', 'installing', 'ready', 'error'].includes(stage.value)
)

// Once the download starts there is nothing sensible to cancel to, so the
// dialog only closes from its own buttons.
const dismissable = computed(() => stage.value === 'available' || stage.value === 'ready' || stage.value === 'error')

const formatMb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`

const downloadedLabel = computed(() =>
  totalBytes.value
    ? `${formatMb(downloadedBytes.value)} of ${formatMb(totalBytes.value)}`
    : formatMb(downloadedBytes.value)
)

const installLabel = computed(() => {
  if (info.value?.kind === 'switch') return 'Switch to stable'
  if (info.value?.kind === 'rollback') return 'Roll back'
  return 'Install now'
})

const closeIfIdle = () => {
  if (dismissable.value) closeDialog()
}

const retry = () => {
  // A rollback's download fails like any other, but checking again wouldn't find it.
  if (info.value?.kind === 'rollback') {
    void downloadAndInstall()
    return
  }
  closeDialog()
  void checkForUpdate()
}

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && visible.value) closeIfIdle()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.update-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: rgba(15, 23, 42, 0.7);
  backdrop-filter: blur(4px);
}

.update-dialog {
  width: 100%;
  max-width: 30rem;
  padding: 1.5rem;
  background: rgba(30, 41, 59, 0.98);
  border: 1px solid var(--color-border-strong);
  border-radius: 0.75rem;
  color: var(--color-text);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
}

.update-title {
  margin: 0 0 0.75rem;
  font-size: 1.15rem;
  font-weight: 600;
}

.update-text {
  margin: 0 0 0.5rem;
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--color-text-muted);
}

.update-hint {
  margin: 0;
  font-size: 0.82rem;
  color: var(--color-text-subtle);
}

.update-notes {
  max-height: 11rem;
  margin: 0.75rem 0;
  padding: 0.75rem;
  overflow-y: auto;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.15);
  border-radius: 0.5rem;
  font-size: 0.82rem;
  line-height: 1.5;
  color: var(--color-text-subtle);
  white-space: pre-wrap;
}

.update-changes {
  max-height: 16rem;
  margin: 0.75rem 0;
  padding: 0.75rem;
  overflow-y: auto;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.15);
  border-radius: 0.5rem;
  font-size: 0.85rem;
  line-height: 1.5;
  color: var(--color-text-muted);
}

.update-changes section + section {
  margin-top: 0.75rem;
}

.update-version {
  margin: 0 0 0.25rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text);
}

.update-list {
  margin: 0;
  padding-left: 1.1rem;
}

.update-bar {
  height: 0.4rem;
  margin: 0.5rem 0 0.75rem;
  background: var(--color-border-strong);
  border-radius: 999px;
  overflow: hidden;
}

.update-fill {
  height: 100%;
  width: 100%;
  /* Scaled rather than resized so progress updates never trigger layout. */
  transform: scaleX(0);
  transform-origin: left center;
  background: var(--color-info);
  border-radius: 999px;
  transition: transform 0.2s ease;
}

/* The installer reports no progress, so show motion instead of a false value. */
.update-fill.indeterminate {
  transform: none;
  animation: update-sweep 1.2s ease-in-out infinite;
}

@keyframes update-sweep {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

.update-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1.25rem;
}

.update-primary,
.update-secondary {
  padding: 0.5rem 0.9rem;
  border-radius: 0.375rem;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease;
}

.update-primary {
  background: var(--color-info);
  border: none;
  color: #fff;
}

.update-primary:hover {
  background: #2563eb;
}

.update-secondary {
  background: transparent;
  border: 1px solid var(--color-border-stronger);
  color: var(--color-text-muted);
}

.update-secondary:hover {
  background: rgba(148, 163, 184, 0.12);
  color: #f1f5f9;
}

.update-dialog-enter-active,
.update-dialog-leave-active {
  transition: opacity 0.2s ease;
}

.update-dialog-enter-from,
.update-dialog-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .update-fill,
  .update-dialog-enter-active,
  .update-dialog-leave-active {
    transition: none;
  }

  .update-fill.indeterminate {
    animation: none;
  }
}
</style>
