import { ref } from 'vue'
import { executeApi, ApiError } from '@/shared/utils/api'
import { localDate } from '@/shared/utils/dates'
import type { ScrumDay, ScrumEntry, ScrumNote, ScrumReport, ScrumPullRequest } from '@/features/scrum/models/scrum'
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

function toPullRequest(raw: unknown): ScrumPullRequest {
  const row = asRecord(raw)
  return {
    id: String(row.id ?? ''),
    number: Number(row.number) || 0,
    repository: String(row.repository ?? ''),
    title: String(row.title ?? ''),
    description: String(row.description ?? ''),
    url: String(row.url ?? ''),
    author: String(row.author ?? ''),
    branch: String(row.branch ?? ''),
    state: String(row.state ?? 'open'),
    isDraft: row.isDraft === true,
    requestedReviewer: row.requestedReviewer === true,
    reviewedByAccount: row.reviewedByAccount === true,
    mentionsAccount: row.mentionsAccount === true,
    isAuthoredByAccount: row.isAuthoredByAccount === true,
    ticketKeys: Array.isArray(row.ticketKeys) ? row.ticketKeys.map(String) : [],
    matchedTicketKeys: Array.isArray(row.matchedTicketKeys) ? row.matchedTicketKeys.map(String) : [],
    updatedAt: asString(row.updatedAt),
    commentCount: row.commentCount === undefined ? undefined : Number(row.commentCount) || 0,
    pendingReview: row.pendingReview === true,
    blockedTicketKeys: Array.isArray(row.blockedTicketKeys) ? row.blockedTicketKeys.map(String) : []
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

// Kept outside useScrum because the page is unmounted when you navigate away.
const report = ref<ScrumReport | null>(null)
const isLoading = ref(false)
const error = ref('')
let latestRequest = 0

const errorMessage = (err: unknown) => err instanceof ApiError ? err.message : String(err)

function toReport(result: Record<string, unknown>): ScrumReport {
  return {
    yesterday: toDay(result.yesterday),
    today: toDay(result.today),
    blockers: Array.isArray(result.blockers) ? result.blockers.map(toNote) : [],
    summary: String(result.summary ?? ''),
    pullRequests: Array.isArray(result.pullRequests) ? result.pullRequests.map(toPullRequest) : []
  }
}

/**
 * Fetch the report and apply it if it's still the newest request and has changed.
 *
 * A request that has to wait on GitHub can take seconds, and its local data would
 * overwrite anything newer, such as a blocker resolved in the meantime. Dropping
 * its result loses nothing, because the backend has cached the pull requests.
 */
async function updateReport(): Promise<void> {
  const request = ++latestRequest
  try {
    const result = await executeApi<Record<string, unknown>>('generate_scrum_summary', {})
    if (request !== latestRequest) return
    if (result?.success === false) {
      throw new Error(String(result.message || 'Failed to build the stand-up report'))
    }
    const next = toReport(result)
    if (JSON.stringify(next) !== JSON.stringify(report.value)) report.value = next
    isLoading.value = false
  } catch (err) {
    if (request !== latestRequest) return
    error.value = errorMessage(err)
    isLoading.value = false
  }
}

/**
 * Called when the GitHub poll has changed the report's pull requests. This keeps
 * the kept report current while the page is closed, so a visit shows the change
 * straight away. Nothing happens until the page has first been opened.
 */
export async function updateScrumReportAfterPoll(): Promise<void> {
  if (report.value) await updateReport()
}

/**
 * Loads the stand-up report and keeps its loading/error state.
 *
 * The local data is read again on every visit because that takes milliseconds,
 * and the backend caches the slow GitHub part. A visit therefore shows the last
 * report straight away and only changes it if something has changed.
 */
export function useScrum() {
  const load = async () => {
    // Yesterday's report must not be shown as today's.
    if (report.value?.today.date !== localDate()) report.value = null
    isLoading.value = report.value === null
    error.value = ''
    await updateReport()
  }

  const resolveBlocker = async (id: number) => {
    error.value = ''
    try {
      await executeApi('resolve_blocker', { id })
    } catch (err) {
      error.value = errorMessage(err)
      return
    }
    await updateReport()
  }

  /**
   * Rebuild the report from the database.
   *
   * Used after planned work changes so the paragraph reflects it immediately.
   */
  const refresh = async () => {
    error.value = ''
    await updateReport()
  }

  return { report, isLoading, error, load, resolveBlocker, refresh }
}
