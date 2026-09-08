export interface AiResult {
  text: string
  usedFallback: boolean
  model?: string
}

export interface BackendAiResponse {
  success?: boolean
  message?: string
  suggested?: string
  summary?: string
  fallback?: string
  enhanced?: string
  category?: string
  model?: string
}
