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
  const unreadStorageKey = 'timelogger.unreadNotifications'
  const unreadNotifications = ref<Notification[]>(loadUnreadNotifications())
  const sidebarOpen = ref(true)
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let notificationSequence = 0

  function loadUnreadNotifications(): Notification[] {
    try {
      const saved = localStorage.getItem(unreadStorageKey)
      if (!saved) return []
      const parsed: unknown = JSON.parse(saved)
      if (!Array.isArray(parsed)) return []
      return parsed.filter((item): item is Notification =>
        !!item && typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.message === 'string' &&
        ['success', 'error', 'info', 'warning'].includes(item.type)
      )
    } catch {
      return []
    }
  }

  const persistUnreadNotifications = () => {
    try {
      localStorage.setItem(unreadStorageKey, JSON.stringify(unreadNotifications.value))
    } catch {
      // Notifications remain usable for this session if storage is unavailable.
    }
  }

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
      duration: notification.duration ?? 3000
    }
    notifications.value.push(notif)
    if (notif.persistent) {
      unreadNotifications.value.unshift({ ...notif })
      persistUnreadNotifications()
    }

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
  const clearAllNotifications = () => {
    for (const notification of unreadNotifications.value) removeNotification(notification.id)
    unreadNotifications.value = []
    persistUnreadNotifications()
  }

  const completeNotification = (id: string) => {
    unreadNotifications.value = unreadNotifications.value.filter(n => n.id !== id)
    removeNotification(id)
    persistUnreadNotifications()
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
    unreadNotifications,
    sidebarOpen,
    setCurrentPage,
    openModal,
    closeModal,
    addNotification,
    removeNotification,
    completeNotification,
    clearAllNotifications,
    reportError,
    showSuccess,
    showError,
    showInfo,
    showWarning,
    toggleSidebar,
    setSidebarOpen
  }
})
