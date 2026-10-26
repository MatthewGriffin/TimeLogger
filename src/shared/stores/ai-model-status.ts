import { defineStore } from 'pinia'
import { ref } from 'vue'
import { executeApi } from '@/shared/utils/api'

type ModelState = 'checking' | 'loaded' | 'not-loaded' | 'unavailable'

interface RuntimeStatus {
  success?: boolean
  ollamaAvailable?: boolean
  loaded?: boolean
  model?: string | null
}

export const useAiModelStatusStore = defineStore('ai-model-status', () => {
  const status = ref<ModelState>('checking')
  const model = ref('')
  const lastCheckedAt = ref<string | null>(null)
  const isRefreshing = ref(false)
  let requestInFlight: Promise<void> | null = null

  const label = () => {
    if (status.value === 'checking') return 'Checking AI model…'
    if (status.value === 'unavailable') return 'AI model unavailable'
    if (status.value === 'loaded') return model.value ? `AI model loaded: ${model.value}` : 'AI model loaded'
    return model.value ? `AI model not loaded: ${model.value}` : 'AI model not loaded'
  }

  const refresh = async () => {
    if (requestInFlight) return requestInFlight
    isRefreshing.value = true
    requestInFlight = (async () => {
      try {
        const result = await executeApi<RuntimeStatus>('get_ai_runtime_status')
        model.value = result?.model || ''
        status.value = !result?.ollamaAvailable
          ? 'unavailable'
          : result.loaded
            ? 'loaded'
            : 'not-loaded'
        lastCheckedAt.value = new Date().toISOString()
      } catch {
        status.value = 'unavailable'
        lastCheckedAt.value = new Date().toISOString()
      } finally {
        isRefreshing.value = false
        requestInFlight = null
      }
    })()
    return requestInFlight
  }

  return { status, model, lastCheckedAt, isRefreshing, label, refresh }
})
