export interface Notification {
  id: string
  type: 'success' | 'error' | 'info' | 'warning'
  message: string
  duration?: number
  url?: string
}

export type ModalPayload = {
  entry?: Record<string, unknown>
  note?: Record<string, unknown>
  confirm?: { message: string; onConfirm?: () => void }
}
