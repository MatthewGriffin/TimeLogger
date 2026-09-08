/**
 * A ticket named as intended work for a day.
 *
 * Carries no duration by design: planned work has no time logged against it
 * and is never submitted to Tempo. It exists so the "today" half of the
 * stand-up report is useful first thing in the morning, before any work has
 * actually been done.
 */
export interface ScrumPlanItem {
  id: number
  date: string
  ticketId: string
  summary: string | null
  status: string | null
}
