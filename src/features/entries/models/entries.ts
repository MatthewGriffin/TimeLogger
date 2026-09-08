export interface ActivityType {
  id: string
  name: string
}

export interface DailySummary {
  [key: string]: unknown
}

export interface IssueData {
  key: string
  summary: string
  status?: string
  issuetype?: string
}

export interface TotalsResponse {
  startDate: string
  endDate: string
  totalMinutes?: number
  totalHours: number
  entriesCount?: number
  submittedCount?: number
  unsubmittedCount?: number
}

export interface UnmappedMeeting {
  subject: string
  entryIds: number[]
}

export interface MeetingConflictResolution {
  attended: boolean
  startTimeOverride: string | null
  endTimeOverride: string | null
}

export interface MeetingConflictEvent {
  id: string
  subject: string
  startTime: string
  endTime: string
  resolution?: MeetingConflictResolution | null
}

export interface MeetingConflict {
  date: string
  events: MeetingConflictEvent[]
}

export interface MeetingConflictResolutionInput {
  eventId: string
  attended: boolean
  startTimeOverride?: string
  endTimeOverride?: string
}

export interface LunchConflictEntry {
  id: number
  name: string
  startTime: string
  endTime: string
}

export interface LunchConflict {
  date: string
  name: string
  startTime: string
  endTime: string
  message: string
  conflictingEntries: LunchConflictEntry[]
}

export interface SubmissionRun {
  id: string
  date: string
  entryCount: number
  failedCount: number
  status: 'success' | 'failed' | 'partial'
  submittedAt: string
}

export interface CalendarSyncResult {
  success: boolean
  created: number
  skipped: number
  clashed?: number
  clashedSubjects?: string[]
  adjusted?: number
  adjustedEntries?: { name: string; was: string; now: string }[]
  unmapped?: number
  unmappedSubjects?: string[]
  unmappedMeetings?: UnmappedMeeting[]
  meetingConflicts?: MeetingConflict[]
  message: string
  notConfigured?: boolean
}
