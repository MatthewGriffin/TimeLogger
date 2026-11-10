import { computed, ref } from 'vue'
import { useEntriesStore } from '@/shared/stores/entries'
import { executeApi, asList } from '@/shared/utils/api'
import { asRecord, asString } from '@/shared/utils/schema'

export interface TicketOption {
  key: string
  description: string
}

// Recent tickets only. Every configured PI ticket is always listed as well.
const RECENT_LIMIT = 10

/**
 * The tickets offered by a ticket field, each with what it is.
 *
 * PI tickets come first and are always listed, so recent tickets can't crowd
 * them out. A description comes from the first place that has one: the PI
 * settings, then Jira, then whatever this ticket was last used for. That keeps
 * them working when Jira isn't connected.
 */
export function useTicketOptions(localTickets: () => TicketOption[] = () => []) {
  const entriesStore = useEntriesStore()
  const piTickets = ref<TicketOption[]>([])

  const loadPiTickets = async () => {
    try {
      const config = asRecord(asRecord(await executeApi('sprint_get_config', {})).config)
      const pi = asString(config.piNumber).trim()
      piTickets.value = asList(config.mappings)
        .map(raw => asRecord(raw))
        .map(mapping => ({
          key: asString(mapping.ticketKey).trim(),
          description: [pi && `PI${pi}`, asString(mapping.label)].filter(Boolean).join(' ')
        }))
        .filter(ticket => ticket.key)
    } catch {
      // The field still works without them, as a plain text box with recent tickets.
      piTickets.value = []
    }
  }

  const ticketOptions = computed<TicketOption[]>(() => {
    const entries = (Array.isArray(entriesStore.entries) ? entriesStore.entries : [])
      .filter(entry => entry.ticketId)
      .map(entry => ({ key: entry.ticketId as string, description: entry.taskName }))
    const issues = (Array.isArray(entriesStore.recentIssues) ? entriesStore.recentIssues : [])
      .map(issue => ({ key: issue.key, description: issue.summary }))
    const local = localTickets()

    const descriptions = new Map<string, string>()
    for (const ticket of [...piTickets.value, ...issues, ...local, ...entries]) {
      const id = ticket.key.toLowerCase()
      if (ticket.description && !descriptions.has(id)) descriptions.set(id, ticket.description)
    }

    const listed = new Set(piTickets.value.map(ticket => ticket.key.toLowerCase()))
    const recent: string[] = []
    for (const { key } of [...local, ...entries, ...issues]) {
      if (recent.length === RECENT_LIMIT) break
      if (listed.has(key.toLowerCase())) continue
      listed.add(key.toLowerCase())
      recent.push(key)
    }

    return [...piTickets.value.map(ticket => ticket.key), ...recent]
      .map(key => ({ key, description: descriptions.get(key.toLowerCase()) ?? '' }))
  })

  return { ticketOptions, loadPiTickets }
}
