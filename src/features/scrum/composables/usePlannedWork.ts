import { ref } from 'vue'
import { executeApi, ApiError } from '@/shared/utils/api'
import type { ScrumPlanItem } from '@/features/scrum/models/scrumPlanItem'
import type { JiraIssueResult } from '@/features/scrum/models/jiraIssueResult'

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

const asString = (value: unknown): string | null =>
  value == null ? null : String(value)

function toIssue(raw: unknown): JiraIssueResult {
  const row = asRecord(raw)
  return {
    key: String(row.key ?? ''),
    summary: String(row.summary ?? ''),
    status: asString(row.status)
  }
}

/**
 * Escape a term for embedding in a JQL string literal.
 *
 * A ticket summary can legitimately contain quotes, and an unescaped one
 * would break the query or, worse, change what it matches.
 */
function jqlLiteral(term: string): string {
  return term.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * Finding and recording the work intended for a day.
 *
 * Kept separate from `useScrum` because it writes: the report is a read-only
 * view built from what already exists, whereas this changes what the next
 * report will say.
 */
export function usePlannedWork() {
  const results = ref<JiraIssueResult[]>([])
  const isSearching = ref(false)
  const isSaving = ref(false)
  const searchError = ref('')
  const hasSearched = ref(false)

  /**
   * Search the user's own Jira issues.
   *
   * Always scoped to `assignee = currentUser()` and open work: the point is to
   * say what you are picking up, and tickets assigned to somebody else or
   * already finished are not candidates for that.
   */
  const search = async (term: string) => {
    isSearching.value = true
    searchError.value = ''
    try {
      const trimmed = term.trim()
      const filters = ['assignee = currentUser()', 'statusCategory != Done']
      if (trimmed) {
        const literal = jqlLiteral(trimmed)
        // A bare key like TIME-101 should find that ticket directly; anything
        // else is treated as free text against the summary.
        filters.push(/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(trimmed)
          ? `(key = "${literal}" OR summary ~ "${literal}")`
          : `summary ~ "${literal}"`)
      }
      const jql = `${filters.join(' AND ')} ORDER BY updated DESC`

      const result = await executeApi<Record<string, unknown>>('tempo_get_issues', { query: jql, limit: 20 })
      if (result?.success === false) {
        throw new Error(String(result.message || 'Could not search Jira'))
      }
      results.value = Array.isArray(result.issues) ? result.issues.map(toIssue) : []
      hasSearched.value = true
    } catch (err) {
      results.value = []
      searchError.value = err instanceof ApiError ? err.message : String(err)
    } finally {
      isSearching.value = false
    }
  }

  const add = async (issue: JiraIssueResult, date: string): Promise<ScrumPlanItem | null> => {
    isSaving.value = true
    searchError.value = ''
    try {
      const result = await executeApi<Record<string, unknown>>('add_planned_work', {
        date,
        ticket_id: issue.key,
        summary: issue.summary,
        status: issue.status
      })
      if (result?.success === false) {
        throw new Error(String(result.message || 'Could not add planned work'))
      }
      const row = asRecord(result.planned)
      return {
        id: Number(row.id),
        date: String(row.date ?? date),
        ticketId: String(row.ticket_id ?? issue.key),
        summary: asString(row.summary),
        status: asString(row.status)
      }
    } catch (err) {
      searchError.value = err instanceof ApiError ? err.message : String(err)
      return null
    } finally {
      isSaving.value = false
    }
  }

  const remove = async (id: number): Promise<boolean> => {
    searchError.value = ''
    try {
      const result = await executeApi<Record<string, unknown>>('remove_planned_work', { id })
      if (result?.success === false) {
        throw new Error(String(result.message || 'Could not remove planned work'))
      }
      return true
    } catch (err) {
      searchError.value = err instanceof ApiError ? err.message : String(err)
      return false
    }
  }

  const reset = () => {
    results.value = []
    searchError.value = ''
    hasSearched.value = false
  }

  return { results, isSearching, isSaving, searchError, hasSearched, search, add, remove, reset }
}
