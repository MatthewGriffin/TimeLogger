<template>
  <div class="support-page page-shell">
    <div class="page-header">
      <div>
        <h1>Support Tickets</h1>
        <p class="page-sub">The 4th line support tickets in your Jira filter, passed between developers. Select one to open it in Jira.</p>
      </div>
      <div class="header-actions">
        <button v-if="settings.filterLink" class="btn" type="button" @click="open(settings.filterLink)">Open filter in Jira ↗</button>
        <button class="btn" type="button" :disabled="loading" @click="load(true)">{{ loading ? 'Refreshing…' : '↻ Refresh' }}</button>
      </div>
    </div>

    <div class="page-body support-body">
      <div v-if="error" class="notice error" role="alert">{{ error }}</div>

      <section class="card controls" aria-label="Support ticket filters">
        <label class="mine">
          <input type="checkbox" :checked="mineOnly" @change="setMineOnly(($event.target as HTMLInputElement).checked)">
          <span>Show just mine</span>
        </label>
        <span class="muted count" role="status">
          {{ visible.length }} shown · {{ tickets.length }} in the filter · {{ mineCount }} assigned to you<template v-if="refreshedLabel"> · {{ refreshedLabel }}</template>
        </span>
        <label class="filter">
          <span>Jira filter (number or link)</span>
          <input v-model="filterText" type="text" placeholder="e.g. 80556 or https://your-site.atlassian.net/issues/?filter=80556" @change="saveFilter">
        </label>
      </section>

      <p v-if="loading && !tickets.length" class="empty">Loading support tickets…</p>
      <p v-else-if="!visible.length && !error" class="empty">
        {{ mineOnly && tickets.length ? 'None of the support tickets are assigned to you. Turn off Show just mine to see all of them.' : 'No support tickets in the filter.' }}
      </p>

      <ul v-else class="tickets" aria-label="Support tickets">
        <li v-for="ticket in visible" :key="ticket.key">
          <button class="card ticket" type="button" :title="`Open ${ticket.key} in Jira`" @click="open(ticket.url)">
            <span class="ticket-top">
              <strong class="key">{{ ticket.key }}</strong>
              <span class="status" :class="`status-${ticket.statusGroup}`">{{ ticket.status }}</span>
              <span v-if="ticket.supportRank !== null" class="rank" title="Support rank">Rank {{ ticket.supportRank }}</span>
            </span>
            <span class="summary">{{ ticket.summary }}</span>
            <span class="meta">
              <span><em>Reporter</em> {{ ticket.reporter || '—' }}</span>
              <span><em>Assignee</em> {{ ticket.assignee || 'Unassigned' }}<template v-if="ticket.isMine"> (you)</template></span>
              <span><em>Product</em> {{ ticket.product || '—' }}</span>
              <span><em>Module</em> {{ ticket.module || '—' }}</span>
            </span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useSupportTickets } from './useSupportTickets'

const { visible, tickets, settings, mineOnly, mineCount, loading, error, fetchedAt, load, loadSettings, setFilter, setMineOnly, open } = useSupportTickets()

const filterText = ref('')
watch(settings, value => { filterText.value = value.filterUrl || value.filterId }, { immediate: true })
const saveFilter = () => setFilter(filterText.value.trim())

const refreshedLabel = computed(() => fetchedAt.value ? `updated ${fetchedAt.value.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : '')

// Tickets get passed on all the time, so the list brings itself up to date
// without interrupting anyone typing in the filter box.
const REFRESH_EVERY_MS = 5 * 60 * 1000
let timer: ReturnType<typeof setInterval> | undefined

onMounted(async () => {
  await loadSettings()
  await load()
  timer = setInterval(() => { if (!(document.activeElement instanceof HTMLInputElement)) void load(true) }, REFRESH_EVERY_MS)
})
onUnmounted(() => clearInterval(timer))
</script>

<style scoped>
.support-page { position: relative; }
.page-sub { margin: .35rem 0 0; color: var(--color-text-muted); }
.header-actions { display: flex; flex-wrap: wrap; gap: .5rem; }
.support-body { display: flex; flex-direction: column; gap: var(--space-lg); }
.btn { padding: .55rem 1rem; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-control); color: var(--color-text); cursor: pointer; }
.btn:disabled { opacity: .55; cursor: default; }
.notice { margin: 0; padding: .85rem 1rem; border: 1px solid var(--color-border); border-radius: var(--radius-md); overflow-wrap: anywhere; }
.notice.error { color: var(--color-danger); border-color: var(--color-danger); }
.card { padding: 1rem 1.25rem; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface-raised); }
.muted { color: var(--color-text-muted); }
.controls { display: flex; flex-wrap: wrap; align-items: end; gap: 1rem 1.5rem; }
.mine { flex-direction: row; align-items: center; gap: .5rem; color: var(--color-text); }
.count { font-size: .9rem; align-self: center; }
.filter { flex: 1 1 20rem; }
label { display: flex; flex-direction: column; gap: .35rem; color: var(--color-text-muted); font-size: .9rem; }
input[type="text"] { padding: .55rem .7rem; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text); font: inherit; min-width: 0; box-sizing: border-box; width: 100%; }
.empty { padding: 1.5rem; text-align: center; border: 1px dashed var(--color-border); border-radius: var(--radius-md); color: var(--color-text-muted); margin: 0; }
.tickets { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .6rem; }
.ticket { width: 100%; display: flex; flex-direction: column; gap: .4rem; text-align: left; color: var(--color-text); font: inherit; cursor: pointer; }
.ticket:hover, .ticket:focus-visible { border-color: var(--color-accent); }
.ticket-top { display: flex; flex-wrap: wrap; align-items: center; gap: .6rem; }
.key { color: var(--color-accent); }
.summary { overflow-wrap: anywhere; }
.rank { margin-left: auto; font-size: .85rem; color: var(--color-text-muted); }
.meta { display: flex; flex-wrap: wrap; gap: .25rem 1.5rem; font-size: .88rem; color: var(--color-text-muted); }
.meta em { font-style: normal; font-size: .75rem; text-transform: uppercase; letter-spacing: .03em; margin-right: .3rem; opacity: .8; }
.status { padding: .12rem .6rem; border-radius: 999px; font-size: .8rem; border: 1px solid currentColor; }
.status-customer { color: var(--color-warning, #b7791f); }
.status-dev { color: var(--color-accent); }
.status-blocked { color: var(--color-danger); }
.status-review { color: var(--color-success); }
.status-investigating { color: var(--color-text); }
.status-other { color: var(--color-text-muted); }
</style>
