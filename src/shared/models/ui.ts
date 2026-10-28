export interface Notification {
  id: string
  type: 'success' | 'error' | 'info' | 'warning'
  message: string
  duration?: number
  url?: string
  /** Keep in the inbox; transient in-app toasts are not unread notifications. */
  persistent?: boolean
}

export type ModalPayload = {
  entry?: Record<string, unknown>
  note?: Record<string, unknown>
  confirm?: { message: string; onConfirm?: () => void }
}
