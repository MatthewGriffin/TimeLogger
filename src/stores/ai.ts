import { defineStore } from 'pinia'
import { ref } from 'vue'
import { executeApi, ApiError } from '../utils/api'
import type { AiResult, BackendAiResponse } from '../models/ai'

export type { AiResult } from '../models/ai'

const textResult = (response: BackendAiResponse, fields: string[], original: string): AiResult => {
  let value: string | undefined
  for (const field of fields) {
    const candidate = response[field as keyof BackendAiResponse]
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      value = candidate
      break
    }
  }
  return {
    text: value ? value.trim() : original,
    usedFallback: response.success !== true || !value,
    model: response.model
  }
}

export const useAiStore = defineStore('ai', () => {
  const isGenerating = ref(false)
  const error = ref('')
  const lastResult = ref<AiResult | null>(null)

  const run = async (request: () => Promise<BackendAiResponse>, fallback: string, unavailableMessage: string) => {
    isGenerating.value = true
    error.value = ''
    try {
      const response = await request()
      const result = textResult(response, ['suggested', 'summary', 'fallback'], fallback)
      if (result.usedFallback && response.message) error.value = response.message
      lastResult.value = result
      return result
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : unavailableMessage
      throw err
    } finally {
      isGenerating.value = false
    }
  }

  const generateDailySummary = (date: string, style = 'professional') =>
    run(
      () => executeApi<BackendAiResponse>('generate_daily_summary', { date, style }),
      `Summary for ${date}: No entries recorded.`,
      'AI summary generation failed'
    )

  const categorizeTask = async (description: string, categories?: string[]) => {
    isGenerating.value = true
    error.value = ''
    try {
      const response = await executeApi<BackendAiResponse>('llm_categorize_task', { description, categories })
      const result = textResult(response, ['category', 'fallback'], 'Other')
      lastResult.value = result
      return result
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : 'AI categorization failed'
      throw err
    } finally {
      isGenerating.value = false
    }
  }

  const clearError = () => { error.value = '' }

  return {
    isGenerating,
    error,
    lastResult,
    generateDailySummary,
    categorizeTask,
    clearError
  }
})
