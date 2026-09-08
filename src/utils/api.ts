import { invoke } from '@tauri-apps/api/core'
import { ApiError } from './errors/api-error'
import type { ApiRequest, ApiResponse } from './api-types'

export { ApiError }
export type { ApiRequest, ApiResponse }

// Matches the backend's default port. Overridable in dev (via VITE_API_PORT)
// so a test instance can be driven without stopping the installed app, which
// owns 3001 whenever it is running.
const API_PORT = import.meta.env.VITE_API_PORT || '3001'
const API_BASE = `http://127.0.0.1:${API_PORT}/api`

// In the packaged desktop app the webview runs on the tauri.localhost origin,
// so calls to the local backend are cross-origin and subject to WebView2's
// CORS/private-network restrictions. Routing them through the Rust host avoids
// that entirely; plain fetch is kept for browser-based development.
const isTauriRuntime = (): boolean =>
  typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)

/**
 * Read a list out of a tool result.
 *
 * `executeApi<T>` is an unchecked cast, so a tool that returns a different
 * shape than the call site claims puts a non-array where an array is expected.
 * Vue then throws inside a render (`x.forEach is not a function`), which aborts
 * the update and leaves the component frozen mid-render — the whole tab appears
 * to hang. Reading lists through this helper keeps a shape mismatch to an empty
 * list instead of a dead page.
 */
export function asList<T>(value: unknown, key?: string): T[] {
  if (Array.isArray(value)) return value as T[]
  if (key && value && typeof value === 'object') {
    const nested = (value as Record<string, unknown>)[key]
    if (Array.isArray(nested)) return nested as T[]
  }
  return []
}

const redactSensitiveText = (value: string) => value
  .replace(/(apiToken|tempoToken|clientSecret|refreshToken|accessToken|token)["']?\s*[:=]\s*["']?[^"',\s}]+/gi, '$1=[REDACTED]')
  .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')

export function unwrapToolResult<T>(payload: unknown): T {
  if (!payload || typeof payload !== 'object') throw new ApiError('Malformed response from server')
  const envelope = payload as Record<string, unknown>
  if (envelope.success === false) {
    throw new ApiError(typeof envelope.message === 'string' ? redactSensitiveText(envelope.message) : 'Operation failed', undefined, payload as ApiResponse)
  }
  let value: unknown = envelope
  if (Object.prototype.hasOwnProperty.call(envelope, 'result')) value = envelope.result
  else if (Object.prototype.hasOwnProperty.call(envelope, 'data')) value = envelope.data
  else if (envelope.success === true) throw new ApiError('Malformed successful response from server', undefined, payload as ApiResponse)
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const toolResult = value as Record<string, unknown>
    if (toolResult.success === false) {
      throw new ApiError(typeof toolResult.message === 'string' ? redactSensitiveText(toolResult.message) : 'Operation failed', undefined, toolResult as unknown as ApiResponse)
    }
  }
  if (value === undefined) throw new ApiError('Malformed response from server')
  return value as T
}

export async function executeApi<T = unknown>(toolName: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    let data: ApiResponse
    if (isTauriRuntime()) {
      data = await invoke<ApiResponse>('api_request', { toolName, args })
    } else {
      const response = await fetch(`${API_BASE}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName, args })
      })
      data = await response.json()
      if (!response.ok && data.success !== true) {
        throw new ApiError(data.message ? redactSensitiveText(data.message) : 'Operation failed', response.status, data)
      }
    }
    return unwrapToolResult<T>(data)
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof SyntaxError) throw new ApiError('Invalid response from server', 500)
    if (error instanceof TypeError) {
      // fetch() reports network failures and blocked cross-origin requests
      // identically, so surface the underlying cause to keep them diagnosable.
      const cause = error.message ? ` (${redactSensitiveText(error.message)})` : ''
      throw new ApiError(`Cannot reach the TimeLogger backend on ${API_BASE}${cause}. Check that the backend is running.`)
    }
    // Rust command rejections arrive as plain strings.
    if (typeof error === 'string') throw new ApiError(redactSensitiveText(error))
    throw new ApiError(redactSensitiveText(error instanceof Error ? error.message : 'Unknown error'))
  }
}
