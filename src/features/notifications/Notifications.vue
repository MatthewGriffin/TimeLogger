<template>
  <div class="notifications-page page-shell">
    <div class="page-header">
      <div>
        <h1>Notifications</h1>
        <p class="page-sub">Unread notifications stay here after their pop-up disappears.</p>
      </div>
      <div class="header-actions">
        <span class="unread-count">{{ notifications.length }} unread</span>
        <button v-if="notifications.length > 0" class="btn-range" type="button" @click="clearAll">Clear all</button>
      </div>
    </div>

    <div class="page-body">
      <div v-if="notifications.length === 0" class="empty-state">
        <Bell class="empty-icon" aria-hidden="true" />
        <h2>You're all caught up</h2>
        <p>External notifications, such as GitHub pull-request activity, will appear here.</p>
      </div>

      <section v-else class="notification-list" aria-label="Unread notifications">
        <button
          v-for="notification in notifications"
          :key="notification.id"
          class="notification-item"
          :class="`notification-${notification.type}`"
          type="button"
          @click="activateNotification(notification)"
        >
          <span class="notification-icon" aria-hidden="true">{{ getIcon(notification.type) }}</span>
          <span class="notification-message">{{ notification.message }}</span>
          <span class="notification-action">{{ notification.url ? 'Open' : 'Mark complete' }} <ArrowUpRight v-if="notification.url" :size="16" aria-hidden="true" /></span>
        </button>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { ArrowUpRight, Bell } from 'lucide-vue-next'
import { useUiStore, type Notification } from '@/shared/stores/ui'

const uiStore = useUiStore()
const notifications = computed(() => uiStore.unreadNotifications)

const clearAll = () => uiStore.clearAllNotifications()

const activateNotification = async (notification: Notification) => {
  // Complete it synchronously so it disappears from the unread list at once.
  uiStore.completeNotification(notification.id)
  if (!notification.url) return

  try {
    await invoke('open_external_url', { url: notification.url })
  } catch (error) {
    uiStore.showError(error instanceof Error ? error.message : 'Could not open link.')
  }
}

const getIcon = (type: Notification['type']) => {
  const icons: Record<Notification['type'], string> = {
    success: '✓',
    error: '✕',
    info: 'ℹ',
    warning: '⚠'
  }
  return icons[type]
}
</script>

<style scoped>
.page-sub { margin: .35rem 0 0; color: var(--color-text-muted); }
.unread-count { color: var(--color-text-muted); font-size: .9rem; }
.page-body { display: flex; flex-direction: column; gap: 1rem; }
.notification-list { display: flex; flex-direction: column; gap: .75rem; }
.notification-item {
  display: flex;
  align-items: center;
  gap: 1rem;
  width: 100%;
  padding: 1rem 1.25rem;
  text-align: left;
  color: var(--color-text);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-left-width: 4px;
  border-radius: var(--radius-md);
  cursor: pointer;
}
.notification-item:hover { background: var(--color-control-hover); }
.notification-success { border-left-color: var(--color-success); }
.notification-error { border-left-color: var(--color-danger); }
.notification-info { border-left-color: var(--color-info); }
.notification-warning { border-left-color: #f59e0b; }
.notification-icon { flex-shrink: 0; font-size: 1.2rem; font-weight: 700; }
.notification-message { flex: 1; min-width: 0; line-height: 1.5; overflow-wrap: anywhere; }
.notification-action { display: inline-flex; align-items: center; gap: .25rem; flex-shrink: 0; color: var(--color-accent); font-size: .85rem; font-weight: 600; }
.empty-state { padding: 4rem 1.5rem; text-align: center; color: var(--color-text-muted); }
.empty-state h2 { color: var(--color-text); }
.empty-icon { width: 2.5rem; height: 2.5rem; }
@media (max-width: 640px) {
  .notification-item { align-items: flex-start; padding: .85rem; gap: .65rem; }
  .notification-action { font-size: .75rem; }
}
</style>
