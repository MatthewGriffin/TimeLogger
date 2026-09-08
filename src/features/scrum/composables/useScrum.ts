import { ref } from 'vue'
import { executeApi, ApiError } from '@/shared/utils/api'
import type { ScrumBlocker, ScrumDay, ScrumEntry, ScrumNote, ScrumReport } from '@/features/scrum/models/scrum'
import type { ScrumPlanItem } from '@/features/scrum/models/scrumPlanItem'

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

function toPlanItem(raw: unknown): ScrumPlanItem {
  const row = asRecord(raw)
  return {
    id: Number(row.id),
    date: String(row.date ?? ''),
    ticketId: String(row.ticket_id ?? ''),
    summary: asString(row.summary),
    status: asString(row.status)
  }
}

function toDay(raw: unknown): ScrumDay {
  const row = asRecord(raw)
  return {
    date: String(row.date ?? ''),
    entries: Array.isArray(row.entries) ? row.entries.map(toEntry) : [],
    notes: Array.isArray(row.notes) ? row.notes.map(toNote) : [],
    planned: Array.isArray(row.planned) ? row.planned.map(toPlanItem) : [],
    totalMinutes: Number(row.totalMinutes) || 0
  }
}

/**
 * Loads the stand-up report and keeps its loading/error state.
 *
 * The paragraph is always composed from the logged entries, notes and planned
 * work. There is no model in this path, so the report is instant and reads the
 * same way every time.
 */
export function useScrum() {
  const report = ref<ScrumReport | null>(null)
  const isLoading = ref(false)
  const error = ref('')

  const fetchReport = async () => {
    const result = await executeApi<Record<string, unknown>>('generate_scrum_summary', {})
    if (result?.success === false) {
      throw new Error(String(result.message || 'Failed to build the stand-up report'))
    }
    return {
      yesterday: toDay(result.yesterday),
      today: toDay(result.today),
      blockers: (Array.isArray(result.blockers) ? result.blockers.map(toNote) : []) as ScrumBlocker[],
      summary: String(result.summary ?? '')
    } as ScrumReport
  }

  const load = async () => {
    isLoading.value = true
    error.value = ''
    try {
      report.value = await fetchReport()
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : String(err)
    } finally {
      isLoading.value = false
    }
  }

  const resolveBlocker = async (id: number) => {
    error.value = ''
    try {
      await executeApi('resolve_blocker', { id })
      report.value = await fetchReport()
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : String(err)
    }
  }

  /**
   * Rebuild the report from the database.
   *
   * Used after planned work changes so the paragraph reflects it immediately.
   */
  const refresh = async () => {
    error.value = ''
    try {
      report.value = await fetchReport()
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : String(err)
    }
  }

  return { report, isLoading, error, load, resolveBlocker, refresh }
}
