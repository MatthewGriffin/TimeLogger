import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Dashboard',
    component: () => import('@/features/dashboard/Dashboard.vue'),
    meta: { title: 'Dashboard' }
  },
  {
    path: '/entries',
    name: 'DailyEntries',
    component: () => import('@/features/entries/DailyEntries.vue'),
    meta: { title: 'Daily Entries' }
  },
  {
    path: '/notes',
    name: 'Notes',
    component: () => import('@/features/notes/Notes.vue'),
    meta: { title: 'Notes' }
  },
  {
    path: '/calendar',
    name: 'Calendar',
    component: () => import('@/features/calendar/Calendar.vue'),
    meta: { title: 'Calendar' }
  },
  {
    path: '/submit',
    name: 'Submit',
    component: () => import('@/features/submit/Submit.vue'),
    meta: { title: 'Submit Time' }
  },
  {
    path: '/tempo',
    name: 'TempoStatus',
    component: () => import('@/features/tempo/TempoStatus.vue'),
    meta: { title: 'Tempo Status' }
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('@/features/settings/Settings.vue'),
    meta: { title: 'Settings' }
  },
  {
    path: '/oauth',
    name: 'MicrosoftOAuth',
    component: () => import('@/features/auth/MicrosoftOAuth.vue'),
    meta: { title: 'Microsoft Authentication' }
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

router.beforeEach((to, _from, next) => {
  document.title = `TimeLogger - ${String(to.meta.title) || 'App'}`
  next()
})

export default router

