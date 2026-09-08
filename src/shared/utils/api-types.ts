/** Shared request/response shapes for the local backend API. */

export interface ApiRequest {
  toolName: string
  args: Record<string, unknown>
}

export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
  result?: T
}
