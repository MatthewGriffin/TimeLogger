export interface ScrumEntry {
  id: number
  ticketId: string | null
  name: string
  startTime: string | null
  endTime: string | null
  durationMins: number
}

export interface ScrumNote {
  id: number
  date: string
  note: string
  title: string | null
  ticketId: string | null
}

export interface ScrumBlocker {
  id: number
  date: string
  note: string
  title: string | null
  ticketId: string | null
}

export interface ScrumDay {
  date: string
  entries: ScrumEntry[]
  notes: ScrumNote[]
  totalMinutes: number
}

export interface ScrumReport {
  yesterday: ScrumDay
  today: ScrumDay
  blockers: ScrumBlocker[]
  summary: string
  /** Whether the paragraph came from the local model or the built-in composer. */
  summarySource: 'ai' | 'fallback'
}
