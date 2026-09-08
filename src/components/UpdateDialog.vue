<!--
  Shows a pending application update and installs it on request.

  A modal, unlike the optional AI model banner: an update is a deliberate
  action the user has either asked for or should consciously accept or defer,
  and once the download starts it must not be possible to lose the dialog
  behind the app and start a second one.
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
          <template v-if="stage === 'available'">Update available</template>
          <template v-else-if="stage === 'downloading'">Downloading update…</template>
          <template v-else-if="stage === 'installing'">Installing…</template>
          <template v-else-if="stage === 'ready'">Update installed</template>
          <template v-else>Update failed</template>
        </h2>

        <template v-if="stage === 'available' && info">
          <p class="update-text">
            TimeLogger <strong>{{ info.version }}</strong> is ready to install.
            You are currently on {{ info.currentVersion }}.
          </p>
          <div v-if="info.notes" class="update-notes">{{ info.notes }}</div>
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
            <button class="update-secondary" @click="dismiss">Later</button>
            <button class="update-primary" @click="downloadAndInstall">Install now</button>
          </template>
          <template v-else-if="stage === 'ready'">
            <button class="update-secondary" @click="dismiss">Restart later</button>
            <button class="update-primary" @click="restartNow">Restart now</button>
          </template>
          <template v-else-if="stage === 'error'">
            <button class="update-secondary" @click="dismiss">Close</button>
            <button class="update-primary" @click="retry">Try again</button>
          </template>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useUpdater } from '../composables/useUpdater'

const {
  stage,
  info,
  errorMessage,
  downloadedBytes,
  totalBytes,
  progressPercent,
  checkForUpdate,
  downloadAndInstall,
  restartNow,
  dismiss
} = useUpdater()

// 'checking' stays hidden so the silent startup check never flashes a dialog.
const visible = computed(() => ['available', 'downloading', 'installing', 'ready', 'error'].includes(stage.value))

// Once the download starts there is nothing sensible to cancel to, so the
// dialog only closes from its own buttons.
const dismissable = computed(() => stage.value === 'available' || stage.value === 'ready' || stage.value === 'error')

const formatMb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`

const downloadedLabel = computed(() =>
  totalBytes.value
    ? `${formatMb(downloadedBytes.value)} of ${formatMb(totalBytes.value)}`
    : formatMb(downloadedBytes.value)
)

const closeIfIdle = () => {
  if (dismissable.value) dismiss()
}

const retry = () => {
  dismiss()
  void checkForUpdate()
}

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && visible.value && dismissable.value) dismiss()
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
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.75rem;
  color: #e2e8f0;
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
  color: #cbd5e1;
}

.update-hint {
  margin: 0;
  font-size: 0.82rem;
  color: #94a3b8;
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
  color: #94a3b8;
  white-space: pre-wrap;
}

.update-bar {
  height: 0.4rem;
  margin: 0.5rem 0 0.75rem;
  background: rgba(148, 163, 184, 0.2);
  border-radius: 999px;
  overflow: hidden;
}

.update-fill {
  height: 100%;
  width: 100%;
  /* Scaled rather than resized so progress updates never trigger layout. */
  transform: scaleX(0);
  transform-origin: left center;
  background: #3b82f6;
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
  background: #3b82f6;
  border: none;
  color: #fff;
}

.update-primary:hover {
  background: #2563eb;
}

.update-secondary {
  background: transparent;
  border: 1px solid rgba(148, 163, 184, 0.3);
  color: #cbd5e1;
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
