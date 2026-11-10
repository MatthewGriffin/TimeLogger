import { ref } from 'vue'
import { executeApi, asList } from '@/shared/utils/api'
import { asRecord, asString } from '@/shared/utils/schema'

/**
 * A time ticket: one of the placeholder tickets that ceremonies and other
 * recurring work are booked against, set up under Current Sprint in Settings.
 */
export interface TimeTicket {
  key: string
  /** The PI number, such as "44". Empty when none is configured. */
  pi: string
  /** What the ticket is for, such as "Daily Scrum". */
  type: string
}

/** The PI and type without the key, for places that already show the key. */
export const timeTicketDetail = (ticket: TimeTicket) =>
  [ticket.pi && `PI ${ticket.pi}`, ticket.type].filter(Boolean).join(' ')

/** The whole label, such as "PI 44 TIME-1234 Daily Scrum". */
export const timeTicketText = (ticket: TimeTicket) =>
  [ticket.pi && `PI ${ticket.pi}`, ticket.key, ticket.type].filter(Boolean).join(' ')

// Shared by every ticket field and list, so they all read the settings once and
// stay in step with each other.
const timeTickets = ref<TimeTicket[]>([])
let pending: Promise<void> | null = null

const load = (): Promise<void> => {
  pending ??= (async () => {
    try {
      const config = asRecord(asRecord(await executeApi('sprint_get_config', {})).config)
      const pi = asString(config.piNumber).trim()
      timeTickets.value = asList(config.mappings)
        .map(raw => asRecord(raw))
        .map(mapping => ({ key: asString(mapping.ticketKey).trim(), pi, type: asString(mapping.label).trim() }))
        .filter(ticket => ticket.key)
    } catch {
      // Fields still work without labels, as plain ticket keys.
      timeTickets.value = []
    } finally {
      pending = null
    }
  })()
  return pending
}

let started = false

/**
 * The configured time tickets and a way to label a ticket key. Loads the
 * settings the first time it is used, and again whenever `reload` is called.
 */
export function useTimeTickets() {
  if (!started) {
    started = true
    void load()
  }

  const find = (key: string | null | undefined): TimeTicket | undefined => {
    const wanted = String(key ?? '').trim().toLowerCase()
    return wanted ? timeTickets.value.find(ticket => ticket.key.toLowerCase() === wanted) : undefined
  }

  /** "PI 44 TIME-1234 Daily Scrum" for a time ticket, and the key itself for any other. */
  const labelFor = (key: string | null | undefined): string => {
    const ticket = find(key)
    return ticket ? timeTicketText(ticket) : String(key ?? '')
  }

  return { timeTickets, find, labelFor, reload: load }
}
