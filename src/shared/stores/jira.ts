import { defineStore } from 'pinia'
import { ref } from 'vue'
import { executeApi, ApiError, asList } from '@/shared/utils/api'
import type { JiraMatch } from '@/shared/models/jira'

export type { JiraMatch } from '@/shared/models/jira'

interface FindTicketResponse {
  success?: boolean
  message?: string
  matches?: JiraMatch[]
  bestMatch?: JiraMatch
  count?: number
  query?: string
  account?: string
}

export const useJiraStore = defineStore('jira', () => {
  const isSearching = ref(false)
  const error = ref('')
  const matches = ref<JiraMatch[]>([])
  const lastQuery = ref('')

  const findTicket = async (query: string, limit = 5) => {
    const trimmed = query.trim()
    if (!trimmed) {
      error.value = 'Enter a task name to search for'
      matches.value = []
      return []
    }

    isSearching.value = true
    error.value = ''
    lastQuery.value = trimmed
    try {
      const response = await executeApi<FindTicketResponse>('jira_find_ticket', { query: trimmed, limit })
      matches.value = asList<JiraMatch>(response, 'matches')
      if (matches.value.length === 0) {
        error.value = response.message || `No Jira tickets found for "${trimmed}"`
      }
      return matches.value
    } catch (err) {
      matches.value = []
      error.value = err instanceof ApiError ? err.message : 'Jira ticket lookup failed'
      throw err
    } finally {
      isSearching.value = false
    }
  }

  /** The user's tickets in any in-progress status, offered when there's nothing to search for. */
  const findInProgress = async (limit = 20) => {
    isSearching.value = true
    error.value = ''
    lastQuery.value = ''
    try {
      const response = await executeApi<{ issues?: Array<{ key: string; summary?: string; status?: string }> }>('tempo_get_issues', {
        query: 'assignee = currentUser() AND statusCategory = "In Progress" ORDER BY updated DESC',
        limit
      })
      matches.value = asList<{ key: string; summary?: string; status?: string }>(response, 'issues')
        .map(issue => ({ key: issue.key, summary: issue.summary || '', status: issue.status || '', confidence: 1 }))
      return matches.value
    } catch (err) {
      matches.value = []
      error.value = err instanceof ApiError ? err.message : 'Jira ticket lookup failed'
      throw err
    } finally {
      isSearching.value = false
    }
  }

  const clear = () => {
    matches.value = []
    error.value = ''
    lastQuery.value = ''
  }

  const clearError = () => { error.value = '' }

  return { isSearching, error, matches, lastQuery, findTicket, findInProgress, clear, clearError }
})
