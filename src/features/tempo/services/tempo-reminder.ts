import { invoke } from '@tauri-apps/api/core'
import { executeApi } from '@/shared/utils/api'
import type { ReminderCheck } from '@/features/tempo/models/reminder'

/**
 * Polls the backend for a due Tempo submission reminder and raises it as a
 * real Windows toast.
 *
 * The decision of whether a reminder is due is deliberately the backend's:
 * it owns the schedule, the entry data, and the once-per-day record, so the
 * timer here only has to ask. The check is a local SQLite read, so running it
 * every minute costs nothing.
 */

const CHECK_INTERVAL_MS = 60_000

let timer: ReturnType<typeof setInterval> | null = null

const runCheck = async () => {
  try {
    const result = await executeApi<ReminderCheck>('check_tempo_reminder')
    if (!result?.shouldNotify) return

    // Routed through Rust so this is a Windows notification that appears even
    // when the window is hidden in the tray - an in-app toast would be
    // invisible at exactly the moment the reminder matters.
    await invoke('show_tempo_reminder_notification', {
      entryCount: result.unsubmittedCount ?? 0,
      minutes: result.unsubmittedMinutes ?? 0
    })
  } catch {
    // A reminder that cannot be shown must never surface an error to the
    // user; the next tick simply tries again.
  }
}

export const startTempoReminderScheduler = () => {
  if (timer) return
  void runCheck()
  timer = setInterval(() => { void runCheck() }, CHECK_INTERVAL_MS)
}

export const stopTempoReminderScheduler = () => {
  if (timer) clearInterval(timer)
  timer = null
}

/**
 * Re-evaluate immediately, clearing today's record first. Called after the
 * schedule is changed so that moving the time to one that has already passed
 * takes effect today rather than tomorrow.
 */
export const refreshTempoReminder = async () => {
  try {
    await executeApi('reset_tempo_reminder')
  } catch {
    // Not fatal - the reminder just keeps its previous once-per-day record.
  }
  await runCheck()
}
