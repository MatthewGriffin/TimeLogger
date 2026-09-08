export interface TimeEntry {
  id: string
  date: string
  taskName: string
  ticketId?: string
  startTime: string
  endTime: string
  duration: number
  submitted: boolean
  submittedAt?: string
  activityType?: string
  fromCalendar?: boolean
}
