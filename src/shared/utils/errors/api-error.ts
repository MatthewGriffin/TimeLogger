import type { ApiResponse } from '@/shared/utils/api-types'

/** Raised when a backend tool call fails or returns a malformed envelope. */
export class ApiError extends Error {
  statusCode?: number
  response?: ApiResponse

  constructor(message: string, statusCode?: number, response?: ApiResponse) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.response = response
  }
}
