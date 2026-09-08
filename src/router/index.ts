import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Dashboard',
    component: () => import('../pages/Dashboard.vue'),
    meta: { title: 'Dashboard' }
  },
  {
    path: '/entries',
    name: 'DailyEntries',
    component: () => import('../pages/DailyEntries.vue'),
    meta: { title: 'Daily Entries' }
  },
  {
    path: '/notes',
    name: 'Notes',
    component: () => import('../pages/Notes.vue'),
    meta: { title: 'Notes' }
  },
  {
    path: '/calendar',
    name: 'Calendar',
    component: () => import('../pages/Calendar.vue'),
    meta: { title: 'Calendar' }
  },
  {
    path: '/submit',
    name: 'Submit',
    component: () => import('../pages/Submit.vue'),
    meta: { title: 'Submit Time' }
  },
  {
    path: '/tempo',
    name: 'TempoStatus',
    component: () => import('../pages/TempoStatus.vue'),
    meta: { title: 'Tempo Status' }
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('../pages/Settings.vue'),
    meta: { title: 'Settings' }
  },
  {
    path: '/oauth',
    name: 'MicrosoftOAuth',
    component: () => import('../pages/MicrosoftOAuth.vue'),
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

