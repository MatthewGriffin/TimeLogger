import { computed, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { executeApi, asList, ApiError } from '@/shared/utils/api'
import { asRecord, asString } from '@/shared/utils/schema'

export type StatusGroup = 'customer' | 'dev' | 'blocked' | 'review' | 'investigating' | 'other'

export interface SupportTicket {
  key: string
  url: string
  summary: string
  status: string
  statusGroup: StatusGroup
  reporter: string
  assignee: string
  isMine: boolean
  supportRank: number | null
  product: string
  module: string
  priority: string
}

export interface SupportSettings {
  filterId: string
  filterUrl: string
  filterLink: string
}

const GROUPS: StatusGroup[] = ['customer', 'dev', 'blocked', 'review', 'investigating', 'other']
const MINE_KEY = 'support-tickets-mine-only'

// Remembered between visits; a browser that won't store it just starts on again.
const readMineOnly = () => {
  try { return localStorage.getItem(MINE_KEY) !== 'false' } catch { return true }
}

function toTicket(raw: unknown): SupportTicket {
  const row = asRecord(raw)
  const group = asString(row.statusGroup) as StatusGroup
  const rank = row.supportRank === null || row.supportRank === undefined ? NaN : Number(row.supportRank)
  return {
    key: asString(row.key),
    url: asString(row.url),
    summary: asString(row.summary),
    status: asString(row.status),
    statusGroup: GROUPS.includes(group) ? group : 'other',
    reporter: asString(row.reporter),
    assignee: asString(row.assignee),
    isMine: Boolean(row.isMine),
    supportRank: Number.isFinite(rank) ? rank : null,
    product: asString(row.product),
    module: asString(row.module),
    priority: asString(row.priority)
  }
}

function toSettings(raw: unknown): SupportSettings {
  const row = asRecord(raw)
  return { filterId: asString(row.filterId), filterUrl: asString(row.filterUrl), filterLink: asString(row.filterLink) }
}

/** The support filter's tickets, with a switch to show just the ones assigned to you. */
export function useSupportTickets() {
  const tickets = ref<SupportTicket[]>([])
  const settings = ref<SupportSettings>({ filterId: '', filterUrl: '', filterLink: '' })
  const mineOnly = ref(readMineOnly())
  const loading = ref(false)
  const error = ref('')
  const fetchedAt = ref<Date | null>(null)

  const visible = computed(() => (mineOnly.value ? tickets.value.filter(ticket => ticket.isMine) : tickets.value))
  const mineCount = computed(() => tickets.value.filter(ticket => ticket.isMine).length)

  const setMineOnly = (value: boolean) => {
    mineOnly.value = value
    try { localStorage.setItem(MINE_KEY, String(value)) } catch { /* only remembered for this visit */ }
  }

  const message = (err: unknown) => (err instanceof ApiError || err instanceof Error ? err.message : String(err))

  const load = async (refresh = false) => {
    loading.value = true
    error.value = ''
    try {
      const result = asRecord(await executeApi('support_tickets_list', { refresh }))
      if (result.success === false) throw new Error(asString(result.message) || 'Could not load the support tickets')
      tickets.value = asList<unknown>(result, 'tickets').map(toTicket)
      settings.value = toSettings(result.settings)
      fetchedAt.value = new Date()
    } catch (err) {
      error.value = message(err)
    } finally {
      loading.value = false
    }
  }

  const loadSettings = async () => {
    try {
      const result = asRecord(await executeApi('support_tickets_settings'))
      if (result.settings) settings.value = toSettings(result.settings)
    } catch { /* shown by the list load */ }
  }

  /** Saves a filter number or link (empty goes back to the default) and reloads. */
  const setFilter = async (filter: string) => {
    error.value = ''
    try {
      const result = asRecord(await executeApi('support_tickets_settings', { filter }))
      if (result.success === false) throw new Error(asString(result.message))
      if (result.settings) settings.value = toSettings(result.settings)
    } catch (err) {
      error.value = message(err)
      return false
    }
    await load(true)
    return true
  }

  const open = async (url: string) => {
    if (!url) return
    try { await invoke('open_external_url', { url }) } catch (err) { error.value = message(err) }
  }

  return { tickets, visible, settings, mineOnly, mineCount, loading, error, fetchedAt, load, loadSettings, setFilter, setMineOnly, open }
}
