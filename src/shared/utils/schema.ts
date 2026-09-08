/**
 * Response validation for backend tool calls.
 *
 * `executeApi<T>` is an unchecked cast: the type parameter is a claim about the
 * response, never a check of it. When a tool's real shape drifts from the claim
 * the mismatch surfaces far from its cause — typically as a TypeError inside a
 * Vue render, which aborts the update and leaves the tab frozen.
 *
 * These readers coerce a response into a known shape at the boundary instead.
 * A field that is missing or the wrong type falls back to a safe default rather
 * than propagating `undefined` into the UI.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const asRecord = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? value : {}

export const asString = (value: unknown, fallback = ''): string => {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return fallback
}

export const asNumber = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const asBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === 'boolean' ? value : (value == null ? fallback : Boolean(value))

/** A string only when genuinely present, so callers can distinguish "unset". */
export const asOptionalString = (value: unknown): string | undefined =>
  value == null || value === '' ? undefined : asString(value)

/**
 * Read an array from a response, tolerating both a bare array and the
 * `{ key: [...] }` envelope most tools return.
 */
export const asArray = (value: unknown, key?: string): unknown[] => {
  if (Array.isArray(value)) return value
  if (key) {
    const nested = asRecord(value)[key]
    if (Array.isArray(nested)) return nested
  }
  return []
}

/**
 * Map a response list through an item reader, dropping items the reader
 * rejects. One malformed row cannot take down the whole list.
 */
export const readList = <T>(
  value: unknown,
  key: string | undefined,
  read: (item: Record<string, unknown>) => T | null
): T[] => {
  const out: T[] = []
  for (const raw of asArray(value, key)) {
    const item = read(asRecord(raw))
    if (item !== null) out.push(item)
  }
  return out
}
