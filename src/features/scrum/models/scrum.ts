import type { ScrumPlanItem } from '@/features/scrum/models/scrumPlanItem'

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
  planned: ScrumPlanItem[]
  totalMinutes: number
}

export interface ScrumPullRequest {
  id: string
  number: number
  repository: string
  title: string
  description: string
  url: string
  author: string
  branch: string
  state: 'open' | 'draft' | 'merged' | 'closed' | string
  isDraft: boolean
  requestedReviewer: boolean
  reviewedByAccount?: boolean
  isAuthoredByAccount: boolean
  ticketKeys: string[]
  matchedTicketKeys: string[]
  updatedAt: string | null
}

export interface ScrumReport {
  yesterday: ScrumDay
  today: ScrumDay
  blockers: ScrumBlocker[]
  summary: string
  pullRequests: ScrumPullRequest[]
}
