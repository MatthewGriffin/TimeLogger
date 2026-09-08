import { ref } from 'vue'
import { executeApi, ApiError } from '@/shared/utils/api'
import type { ScrumBlocker, ScrumDay, ScrumEntry, ScrumNote, ScrumReport } from '@/features/scrum/models/scrum'

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

const asString = (value: unknown): string | null =>
  value == null ? null : String(value)

function toEntry(raw: unknown): ScrumEntry {
  const row = asRecord(raw)
  return {
    id: Number(row.id),
    ticketId: asString(row.ticket_id),
    name: String(row.name ?? ''),
    startTime: asString(row.start_time),
    endTime: asString(row.end_time),
    durationMins: Number(row.duration_mins) || 0
  }
}

function toNote(raw: unknown): ScrumNote {
  const row = asRecord(raw)
  return {
    id: Number(row.id),
    date: String(row.date ?? ''),
    note: String(row.note ?? ''),
    title: asString(row.title),
    ticketId: asString(row.ticket_id)
  }
}

function toDay(raw: unknown): ScrumDay {
  const row = asRecord(raw)
  return {
    date: String(row.date ?? ''),
    entries: Array.isArray(row.entries) ? row.entries.map(toEntry) : [],
    notes: Array.isArray(row.notes) ? row.notes.map(toNote) : [],
    totalMinutes: Number(row.totalMinutes) || 0
  }
}

/**
 * Loads the stand-up report and keeps its loading/error state.
 *
 * `useAi` is passed through rather than assumed: the backend falls back to a
 * composed paragraph when the local model is unavailable, so the page works
 * with Ollama switched off.
 */
export function useScrum() {
  const report = ref<ScrumReport | null>(null)
  const isLoading = ref(false)
  const isRegenerating = ref(false)
  const error = ref('')

  const fetchReport = async (useAi: boolean) => {
    const result = await executeApi<Record<string, unknown>>('generate_scrum_summary', { use_ai: useAi })
    if (result?.success === false) {
      throw new Error(String(result.message || 'Failed to build the stand-up report'))
    }
    return {
      yesterday: toDay(result.yesterday),
      today: toDay(result.today),
      blockers: (Array.isArray(result.blockers) ? result.blockers.map(toNote) : []) as ScrumBlocker[],
      summary: String(result.summary ?? ''),
      summarySource: result.summarySource === 'ai' ? 'ai' : 'fallback'
    } as ScrumReport
  }

  const load = async (useAi = true) => {
    isLoading.value = true
    error.value = ''
    try {
      report.value = await fetchReport(useAi)
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : String(err)
    } finally {
      isLoading.value = false
    }
  }

  const regenerate = async (useAi = true) => {
    isRegenerating.value = true
    error.value = ''
    try {
      report.value = await fetchReport(useAi)
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : String(err)
    } finally {
      isRegenerating.value = false
    }
  }

  const resolveBlocker = async (id: number) => {
    error.value = ''
    try {
      await executeApi('resolve_blocker', { id })
      // Reload without the model so resolving a blocker is instant; the
      // paragraph is refreshed explicitly by the regenerate button.
      report.value = await fetchReport(false)
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : String(err)
    }
  }

  return { report, isLoading, isRegenerating, error, load, regenerate, resolveBlocker }
}
