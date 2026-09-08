import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ModalPayload, Notification } from '@/shared/models/ui'

export type { ModalPayload, Notification } from '@/shared/models/ui'

export const useUiStore = defineStore('ui', () => {
  const currentPage = ref<string>('dashboard')
  const showModal = ref(false)
  const modalType = ref<'entry' | 'note' | 'confirm' | null>(null)
  const modalPayload = ref<ModalPayload>({})
  const notifications = ref<Notification[]>([])
  const sidebarOpen = ref(true)
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let notificationSequence = 0

  const setCurrentPage = (page: string) => {
    currentPage.value = page
  }

  const openModal = (type: 'entry' | 'note' | 'confirm', payload: ModalPayload = {}) => {
    modalType.value = type
    modalPayload.value = payload
    showModal.value = true
  }

  const closeModal = () => {
    showModal.value = false
    modalType.value = null
    modalPayload.value = {}
  }

  const addNotification = (notification: Omit<Notification, 'id'>) => {
    const id = `notif_${Date.now()}_${notificationSequence++}_${Math.random().toString(36).slice(2, 8)}`
    const notif: Notification = {
      ...notification,
      id,
      duration: notification.duration || 3000
    }
    notifications.value.push(notif)

    if (notif.duration && notif.duration > 0) {
      timers.set(id, setTimeout(() => {
        removeNotification(id)
      }, notif.duration))
    }

    return id
  }

  const removeNotification = (id: string) => {
    const timer = timers.get(id)
    if (timer) clearTimeout(timer)
    timers.delete(id)
    notifications.value = notifications.value.filter(n => n.id !== id)
  }
  const reportError = (error: unknown, fallback = 'Something went wrong') => {
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : fallback
    return showError(message)
  }

  const showSuccess = (message: string, duration?: number) => {
    return addNotification({ type: 'success', message, duration })
  }

  const showError = (message: string, duration?: number) => {
    return addNotification({ type: 'error', message, duration })
  }

  const showInfo = (message: string, duration?: number) => {
    return addNotification({ type: 'info', message, duration })
  }

  const showWarning = (message: string, duration?: number) => {
    return addNotification({ type: 'warning', message, duration })
  }

  const toggleSidebar = () => {
    sidebarOpen.value = !sidebarOpen.value
  }

  const setSidebarOpen = (open: boolean) => {
    sidebarOpen.value = open
  }

  return {
    currentPage,
    showModal,
    modalType,
    modalPayload,
    notifications,
    sidebarOpen,
    setCurrentPage,
    openModal,
    closeModal,
    addNotification,
    removeNotification,
    reportError,
    showSuccess,
    showError,
    showInfo,
    showWarning,
    toggleSidebar,
    setSidebarOpen
  }
})
