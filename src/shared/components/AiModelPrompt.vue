<!--
  Offers the recommended local AI model when it is missing.

  Deliberately a quiet, dismissible banner rather than a modal: a fresh
  install should not be blocked by an optional download, and AI features
  degrade gracefully without it. The check runs after startup and stays
  silent unless there is something to offer.
-->
<template>
  <transition name="model-prompt">
    <div v-if="visible" class="model-prompt" role="status">
      <div class="model-prompt-icon">{{ downloading ? '⬇' : complete ? '✓' : '🤖' }}</div>

      <div class="model-prompt-body">
        <template v-if="complete">
          <p class="model-prompt-title">AI model ready</p>
          <p class="model-prompt-text">Notes will now be categorised automatically.</p>
        </template>

        <template v-else-if="downloading">
          <p class="model-prompt-title">Downloading {{ recommendedModel }}…</p>
          <div class="model-prompt-bar" role="progressbar" :aria-valuenow="percent" aria-valuemin="0" aria-valuemax="100">
            <div class="model-prompt-fill" :style="{ transform: `scaleX(${percent / 100})` }"></div>
          </div>
          <p class="model-prompt-text">{{ percent }}% — carry on working, this runs in the background.</p>
        </template>

        <template v-else-if="failed">
          <p class="model-prompt-title">Download failed</p>
          <p class="model-prompt-text">{{ error }}</p>
        </template>

        <template v-else>
          <p class="model-prompt-title">Speed up AI note categorising</p>
          <p class="model-prompt-text">
            Download {{ recommendedModel }} ({{ recommendedSize }}) — it runs entirely on your GPU,
            so it stays fast and out of the way. Optional.
          </p>
        </template>
      </div>

      <div class="model-prompt-actions">
        <button v-if="offering" class="model-prompt-primary" @click="install">Download</button>
        <button v-if="failed" class="model-prompt-primary" @click="install">Retry</button>
        <button class="model-prompt-close" :aria-label="offering ? 'Not now' : 'Dismiss'" @click="dismiss">✕</button>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { executeApi } from '@/shared/utils/api'

interface ModelStatus {
  success?: boolean
  ollamaAvailable?: boolean
  shouldOffer?: boolean
  recommendedModel?: string
  recommendedSize?: string
}

interface PullProgress {
  status?: string
  percent?: number
  error?: string
}

type PromptState = 'hidden' | 'offering' | 'downloading' | 'complete' | 'failed'

const state = ref<PromptState>('hidden')
const percent = ref(0)
const error = ref('')
const recommendedModel = ref('')
const recommendedSize = ref('')
let pollTimer: ReturnType<typeof setInterval> | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null

const visible = computed(() => state.value !== 'hidden')
const offering = computed(() => state.value === 'offering')
const downloading = computed(() => state.value === 'downloading')
const complete = computed(() => state.value === 'complete')
const failed = computed(() => state.value === 'failed')

const stopPolling = () => {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}

const check = async () => {
  try {
    const status = await executeApi<ModelStatus>('get_ai_model_status')
    recommendedModel.value = status?.recommendedModel || ''
    recommendedSize.value = status?.recommendedSize || ''
    if (status?.shouldOffer) state.value = 'offering'
  } catch {
    // A failed check must never surface as an error - the model is optional.
  }
}

const install = async () => {
  state.value = 'downloading'
  percent.value = 0
  error.value = ''
  try {
    await executeApi('install_recommended_model')
  } catch (err) {
    state.value = 'failed'
    error.value = err instanceof Error ? err.message : 'Could not start the download.'
    return
  }

  stopPolling()
  pollTimer = setInterval(async () => {
    try {
      const progress = await executeApi<PullProgress>('get_model_download_progress')
      percent.value = progress?.percent ?? 0
      if (progress?.status === 'complete') {
        stopPolling()
        state.value = 'complete'
        // Confirm briefly, then get out of the way on its own.
        hideTimer = setTimeout(() => { state.value = 'hidden' }, 6000)
      } else if (progress?.status === 'error') {
        stopPolling()
        state.value = 'failed'
        error.value = progress.error || 'The download did not finish.'
      }
    } catch {
      // Transient poll failures are ignored; the next tick retries.
    }
  }, 1000)
}

const dismiss = async () => {
  const wasOffering = offering.value
  state.value = 'hidden'
  stopPolling()
  // Only a declined offer is remembered. Closing a progress or error banner
  // just hides it, so the offer can return next launch.
  if (!wasOffering) return
  try {
    await executeApi('dismiss_model_recommendation')
  } catch {
    // Losing the preference only means asking again next time.
  }
}

onUnmounted(() => {
  stopPolling()
  if (hideTimer) clearTimeout(hideTimer)
})

defineExpose({ check })
</script>

<style scoped>
.model-prompt {
  position: fixed;
  bottom: 2rem;
  left: 2rem;
  z-index: 9998;
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  max-width: 26rem;
  padding: 1rem 1.25rem;
  background: rgba(30, 41, 59, 0.96);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.5rem;
  color: #e2e8f0;
  backdrop-filter: blur(10px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.model-prompt-icon {
  flex-shrink: 0;
  font-size: 1.1rem;
  line-height: 1.4;
}

.model-prompt-body {
  flex: 1;
  min-width: 0;
}

.model-prompt-title {
  margin: 0 0 0.25rem;
  font-size: 0.95rem;
  font-weight: 600;
}

.model-prompt-text {
  margin: 0;
  font-size: 0.82rem;
  line-height: 1.45;
  color: #94a3b8;
}

.model-prompt-bar {
  height: 0.35rem;
  margin: 0.5rem 0;
  background: rgba(148, 163, 184, 0.2);
  border-radius: 999px;
  overflow: hidden;
}

.model-prompt-fill {
  height: 100%;
  width: 100%;
  /* Scaled rather than resized so progress updates never trigger layout. */
  transform: scaleX(0);
  transform-origin: left center;
  background: #3b82f6;
  border-radius: 999px;
  transition: transform 0.3s ease;
}

.model-prompt-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 0.5rem;
}

.model-prompt-primary {
  padding: 0.4rem 0.75rem;
  background: #3b82f6;
  border: none;
  border-radius: 0.375rem;
  color: #fff;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s ease;
}

.model-prompt-primary:hover {
  background: #2563eb;
}

.model-prompt-close {
  background: none;
  border: none;
  color: #94a3b8;
  font-size: 1rem;
  line-height: 1;
  padding: 0.25rem;
  cursor: pointer;
  transition: color 0.2s ease;
}

.model-prompt-close:hover {
  color: #cbd5e1;
}

.model-prompt-enter-active,
.model-prompt-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.model-prompt-enter-from,
.model-prompt-leave-to {
  opacity: 0;
  transform: translateY(1rem);
}

@media (max-width: 640px) {
  .model-prompt {
    left: 1rem;
    right: 1rem;
    bottom: 1rem;
    max-width: none;
  }
}
</style>
