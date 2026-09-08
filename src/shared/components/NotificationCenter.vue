<template>
  <div class="notification-center">
    <transition-group name="notification" tag="div">
      <div
        v-for="notif in notifications"
        :key="notif.id"
        :class="['notification', `notification-${notif.type}`]"
        @click="removeNotification(notif.id)"
      >
        <div class="notification-icon">{{ getIcon(notif.type) }}</div>
        <div class="notification-content">{{ notif.message }}</div>
        <button class="notification-close" @click.stop="removeNotification(notif.id)">✕</button>
      </div>
    </transition-group>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useUiStore } from '@/shared/stores/ui'

const uiStore = useUiStore()
const notifications = computed(() => uiStore.notifications)

const removeNotification = (id: string) => {
  uiStore.removeNotification(id)
}

const getIcon = (type: string) => {
  const icons: Record<string, string> = {
    success: '✓',
    error: '✕',
    info: 'ℹ',
    warning: '⚠'
  }
  return icons[type] || '●'
}
</script>

<style scoped>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

.notification-center {
  position: fixed;
  bottom: 2rem;
  right: 2rem;
  z-index: 9999;
  max-width: 400px;
}

.notification {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.5rem;
  background: rgba(30, 41, 59, 0.95);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.5rem;
  color: #e2e8f0;
  margin-bottom: 0.75rem;
  backdrop-filter: blur(10px);
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.notification:hover {
  background: rgba(30, 41, 59, 0.98);
  border-color: rgba(148, 163, 184, 0.3);
  transform: translateX(-4px);
}

.notification-icon {
  flex-shrink: 0;
  font-size: 1.2rem;
  font-weight: 600;
  min-width: 24px;
  text-align: center;
}

.notification-success {
  border-color: rgba(16, 185, 129, 0.3);
  background: rgba(16, 185, 129, 0.1);
}

.notification-success .notification-icon {
  color: #10b981;
}

.notification-error {
  border-color: rgba(239, 68, 68, 0.3);
  background: rgba(239, 68, 68, 0.1);
}

.notification-error .notification-icon {
  color: #ef4444;
}

.notification-info {
  border-color: rgba(59, 130, 246, 0.3);
  background: rgba(59, 130, 246, 0.1);
}

.notification-info .notification-icon {
  color: #3b82f6;
}

.notification-warning {
  border-color: rgba(245, 158, 11, 0.3);
  background: rgba(245, 158, 11, 0.1);
}

.notification-warning .notification-icon {
  color: #f59e0b;
}

.notification-content {
  flex: 1;
  font-size: 0.95rem;
  line-height: 1.4;
}

.notification-close {
  flex-shrink: 0;
  background: none;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  font-size: 1.2rem;
  padding: 0;
  transition: color 0.3s ease;
}

.notification-close:hover {
  color: #cbd5e1;
}

/* Animations */
.notification-enter-active {
  animation: slideIn 0.3s ease-out;
}

.notification-leave-active {
  animation: slideOut 0.3s ease-in;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateX(100px) translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateX(0) translateY(0);
  }
}

@keyframes slideOut {
  from {
    opacity: 1;
    transform: translateX(0) translateY(0);
  }
  to {
    opacity: 0;
    transform: translateX(100px) translateY(20px);
  }
}

/* Responsive */
@media (max-width: 640px) {
  .notification-center {
    bottom: 1rem;
    right: 1rem;
    left: 1rem;
    max-width: none;
  }

  .notification {
    margin-bottom: 0.5rem;
  }
}
</style>
