<template>
  <nav :class="['navigation', { collapsed: !sidebarOpen }]">
    <div class="nav-header">
      <div class="nav-branding">
        <div class="nav-logo">⏱️</div>
        <!-- Branding, not a page heading: the view supplies the page's <h1>,
             and a second one here made every page report two top-level
             headings to assistive tech. -->
        <span v-if="sidebarOpen" class="nav-title">TimeLogger</span>
      </div>
      <button
        class="nav-toggle"
        type="button"
        :aria-expanded="sidebarOpen"
        :title="sidebarOpen ? 'Collapse menu' : 'Expand menu'"
        :aria-label="sidebarOpen ? 'Collapse menu' : 'Expand menu'"
        @click="toggleSidebar"
      >
        {{ sidebarOpen ? '◀' : '▶' }}
      </button>
    </div>

    <div class="nav-links">
      <router-link
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        :class="['nav-link', { active: isActive(item.path) }]"
        :title="sidebarOpen ? undefined : item.label"
        :aria-label="item.label"
      >
        <span class="nav-icon">{{ item.icon }}</span>
        <span v-if="sidebarOpen" class="nav-label">{{ item.label }}</span>
      </router-link>
    </div>

    <div class="nav-footer">
      <router-link
        to="/settings"
        :class="['nav-link', { active: isActive('/settings') }]"
        :title="sidebarOpen ? undefined : 'Settings'"
        aria-label="Settings"
      >
        <span class="nav-icon">⚙️</span>
        <span v-if="sidebarOpen" class="nav-label">Settings</span>
      </router-link>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useUiStore } from '@/shared/stores/ui'

const router = useRouter()
const uiStore = useUiStore()
const sidebarOpen = computed(() => uiStore.sidebarOpen)

const toggleSidebar = () => {
  uiStore.toggleSidebar()
}

const navItems = [
  { path: '/', label: 'Dashboard', icon: '📊' },
  { path: '/entries', label: 'Daily Entries', icon: '📝' },
  { path: '/notes', label: 'Notes', icon: '📌' },
  { path: '/calendar', label: 'Calendar', icon: '📅' },
  { path: '/submit', label: 'Submit Time', icon: '✈️' },
  { path: '/tempo', label: 'Tempo Status', icon: '🧾' }
]

const isActive = (path: string) => {
  return router.currentRoute.value.path === path
}
</script>

<style scoped>
.navigation {
  display: flex;
  flex-direction: column;
  width: 280px;
  flex-shrink: 0;
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.95), rgba(10, 15, 30, 0.95));
  border-right: 1px solid var(--color-border);
  min-height: 100vh;
  backdrop-filter: blur(10px);
  position: relative;
  z-index: 50;
  transition: width 0.25s ease;
}

.navigation.collapsed {
  width: 80px;
}

/* Collapsed, the rail is too narrow for a row layout: the toggle would be
   squeezed against the logo. Stacking keeps both usable. */
.navigation.collapsed .nav-header {
  flex-direction: column;
  padding: 1.25rem 0.5rem;
  gap: 0.75rem;
}

.navigation.collapsed .nav-branding {
  justify-content: center;
  flex: none;
}

.navigation.collapsed .nav-links,
.navigation.collapsed .nav-footer {
  padding: 1rem 0.5rem;
}

.navigation.collapsed .nav-link {
  justify-content: center;
  padding: 0.75rem 0;
}

@media (prefers-reduced-motion: reduce) {
  .navigation {
    transition: none;
  }
}

.nav-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  border-bottom: 1px solid var(--color-border);
  gap: 1rem;
}

.nav-branding {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex: 1;
  min-width: 0;
}

.nav-logo {
  font-size: 1.5rem;
  flex-shrink: 0;
}

.nav-title {
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--color-accent);
  letter-spacing: -0.3px;
  white-space: nowrap;
  overflow: hidden;
}

.nav-toggle {
  background: var(--color-control);
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
  width: 36px;
  height: 36px;
  border-radius: 0.5rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
  flex-shrink: 0;
}

.nav-toggle:hover {
  background: var(--color-control-hover);
  color: var(--color-text);
}

.nav-links {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem;
  overflow-y: auto;
}

.nav-footer {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem;
  border-top: 1px solid var(--color-border);
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  color: var(--color-text-muted);
  text-decoration: none;
  border-radius: 0.5rem;
  transition: all 0.3s ease;
  font-weight: 500;
  font-size: 0.95rem;
  white-space: nowrap;
  cursor: pointer;
}

.nav-link:hover {
  background: var(--color-control);
  color: var(--color-text);
}

.nav-link.active {
  background: var(--color-accent-muted);
  color: var(--color-accent);
  border-bottom: 2px solid var(--color-accent);
  padding-bottom: calc(0.75rem - 2px);
}

.nav-icon {
  font-size: 1.2rem;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
}

.nav-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Scrollbar styling */
.nav-links::-webkit-scrollbar {
  width: 6px;
}

.nav-links::-webkit-scrollbar-track {
  background: transparent;
}

.nav-links::-webkit-scrollbar-thumb {
  background: var(--color-border-strong);
  border-radius: 3px;
}

.nav-links::-webkit-scrollbar-thumb:hover {
  background: rgba(148, 163, 184, 0.4);
}

/* Responsive */
@media (max-width: 768px) {
  .navigation {
    width: 80px;
  }

  .nav-branding {
    justify-content: center;
  }

  .nav-title {
    display: none;
  }

  .nav-label {
    display: none;
  }

  .nav-link {
    justify-content: center;
    padding: 0.75rem;
  }

  .nav-link.active {
    border-left: none;
    border-bottom: 3px solid var(--color-accent);
    padding-bottom: calc(0.75rem - 3px);
  }
}
</style>
