import { computed, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { executeApi, asList, ApiError } from '@/shared/utils/api'
import { asRecord, asString } from '@/shared/utils/schema'

export interface PlanTicket {
  key: string
  summary: string
  status: string
  statusCategory: string
  points: number | null
  pointsManual: boolean
  noteCount: number
}

export interface PlanSummary {
  tickets: number
  planned: number
  done: number
  inProgress: number
  todo: number
  unestimated: number
  capacity: number | null
  remaining: number | null
  overCapacity: boolean
}

export interface PlanState {
  phase: 'planning' | 'active'
  capacity: number | null
  boardId: string
  boardUrl: string
  startedAt: string | null
}

export interface SearchResult {
  key: string
  summary: string
  status: string
  points: number | null
  planned: boolean
}

export interface PlanNote {
  id: number
  note: string
  date: string
}

const toNumber = (value: unknown): number | null => (value == null || value === '' ? null : Number(value))

const toTicket = (raw: unknown): PlanTicket => {
  const row = asRecord(raw)
  return {
    key: asString(row.key),
    summary: asString(row.summary),
    status: asString(row.status),
    statusCategory: asString(row.statusCategory),
    points: toNumber(row.points),
    pointsManual: Boolean(row.pointsManual),
    noteCount: Number(row.noteCount) || 0
  }
}

const emptySummary = (): PlanSummary => ({
  tickets: 0, planned: 0, done: 0, inProgress: 0, todo: 0, unestimated: 0, capacity: null, remaining: null, overCapacity: false
})

const localDate = () => new Date().toLocaleDateString('en-CA')

/**
 * The sprint plan: tickets chosen for the next sprint, then their progress once
 * the sprint starts. Every call returns the whole plan, so the page never has
 * to patch its own copy and cannot drift from what is saved.
 */
export function useSprintPlan() {
  const state = ref<PlanState>({ phase: 'planning', capacity: null, boardId: '', boardUrl: '', startedAt: null })
  const tickets = ref<PlanTicket[]>([])
  const summary = ref<PlanSummary>(emptySummary())
  const loading = ref(false)
  const busy = ref(false)
  const error = ref('')
  const results = ref<SearchResult[]>([])
  const searching = ref(false)
  const searched = ref(false)

  const apply = (value: unknown) => {
    const data = asRecord(value)
    const raw = asRecord(data.state)
    state.value = {
      phase: raw.phase === 'active' ? 'active' : 'planning',
      capacity: toNumber(raw.capacity),
      boardId: asString(raw.boardId),
      boardUrl: asString(raw.boardUrl),
      startedAt: raw.startedAt ? asString(raw.startedAt) : null
    }
    tickets.value = asList(data.tickets).map(toTicket)
    summary.value = { ...emptySummary(), ...asRecord(data.summary) } as PlanSummary
    // Results already added to the plan should say so.
    const inPlan = new Set(tickets.value.map(ticket => ticket.key.toLowerCase()))
    results.value = results.value.map(result => ({ ...result, planned: inPlan.has(result.key.toLowerCase()) }))
  }

  /** Run a plan-changing call; its failure becomes the page's message rather than an unhandled rejection. */
  const run = async (tool: string, args: Record<string, unknown> = {}) => {
    busy.value = true
    error.value = ''
    try {
      apply(await executeApi(tool, args))
      return true
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : String(err)
      return false
    } finally {
      busy.value = false
    }
  }

  const load = async () => {
    loading.value = true
    try { await run('sprint_plan_get') } finally { loading.value = false }
  }

  const search = async (query: string) => {
    searching.value = true
    error.value = ''
    try {
      const response = await executeApi('sprint_plan_search', { query })
      results.value = asList(response, 'issues').map(raw => {
        const row = asRecord(raw)
        return {
          key: asString(row.key), summary: asString(row.summary), status: asString(row.status),
          points: toNumber(row.points), planned: Boolean(row.planned)
        }
      })
      searched.value = true
    } catch (err) {
      results.value = []
      error.value = err instanceof ApiError ? err.message : String(err)
    } finally {
      searching.value = false
    }
  }

  const add = (key: string) => run('sprint_plan_add', { ticket_id: key })
  const remove = (key: string) => run('sprint_plan_remove', { ticket_id: key })
  const setPoints = (key: string, points: number | null) => run('sprint_plan_set_points', { ticket_id: key, points })
  const setCapacity = (capacity: number | null) => run('sprint_plan_settings', { capacity })
  const setBoard = (board: string) => run('sprint_plan_settings', { board })
  const refresh = () => run('sprint_plan_refresh')
  const start = () => run('sprint_plan_start')
  const finish = () => run('sprint_plan_finish')

  /** Opens the user's own view of the board in the browser. */
  const openBoard = async () => {
    error.value = ''
    try {
      const { url } = asRecord(await executeApi('sprint_plan_board_link'))
      await invoke('open_external_url', { url: asString(url) })
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    }
  }

  // Notes are ordinary notes filed under the ticket, so they show on the Notes page too.
  const loadNotes = async (key: string): Promise<PlanNote[]> => {
    const response = await executeApi('get_notes', { topic: key })
    return asList(response, 'notes').map(raw => {
      const row = asRecord(raw)
      return { id: Number(row.id), note: asString(row.note), date: asString(row.date) }
    })
  }

  const addNote = async (key: string, note: string): Promise<boolean> => {
    error.value = ''
    try {
      await executeApi('create_note', { date: localDate(), note, ticket_id: key })
      await run('sprint_plan_get')
      return true
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : String(err)
      return false
    }
  }

  const columns = computed(() => [
    { id: 'new', title: 'To Do', tickets: tickets.value.filter(t => t.statusCategory !== 'indeterminate' && t.statusCategory !== 'done') },
    { id: 'indeterminate', title: 'In Progress', tickets: tickets.value.filter(t => t.statusCategory === 'indeterminate') },
    { id: 'done', title: 'Done', tickets: tickets.value.filter(t => t.statusCategory === 'done') }
  ])

  return {
    state, tickets, summary, loading, busy, error, results, searching, searched, columns,
    load, search, add, remove, setPoints, setCapacity, setBoard, refresh, start, finish, openBoard, loadNotes, addNote
  }
}
