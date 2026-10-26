<template>
  <section v-if="pullRequests.length" class="pr-panel">
    <header>
      <h2>Related GitHub Pull Requests</h2>
      <p>Pull requests matching ticket keys from logged or planned work.</p>
    </header>
    <div v-for="group in groups" :key="group.ticket" class="ticket-group">
      <h3>
        <a v-if="jiraBaseUrl" :href="jiraBaseUrl + '/browse/' + group.ticket" target="_blank" rel="noopener noreferrer">{{ group.ticket }}</a>
        <span v-else>{{ group.ticket }}</span>
      </h3>
      <article v-for="pr in group.items" :key="pr.id" class="pr-row">
        <div class="pr-main">
          <a class="pr-title" :href="pr.url" @click.prevent="openPr(pr.url)">{{ pr.title }}</a>
          <p class="pr-meta">
            {{ pr.repository }}#{{ pr.number }} · {{ pr.state }}
            <span v-if="pr.isAuthoredByAccount">· authored by you</span>
            <span v-else-if="pr.requestedReviewer">· review requested</span>
            <span v-else-if="pr.reviewedByAccount">· reviewed by you</span>
          </p>
          <p v-if="pr.description" class="pr-description">{{ pr.description }}</p>
          <p v-else class="pr-description muted">No description provided.</p>
        </div>
        <span class="state" :class="'state-' + pr.state">{{ stateLabel(pr.state) }}</span>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { ScrumPullRequest } from '@/features/scrum/models/scrum'
import { useUiStore } from '@/shared/stores/ui'
import { useConfigStore } from '@/shared/stores/config'

const props = defineProps<{ pullRequests: ScrumPullRequest[] }>()
const uiStore = useUiStore()
const configStore = useConfigStore()
const jiraBaseUrl = computed(() => String(configStore.config.jira?.baseUrl || '').replace(/\/$/, ''))

const groups = computed(() => {
  const grouped = new Map<string, ScrumPullRequest[]>()
  for (const pr of props.pullRequests) {
    for (const ticket of pr.matchedTicketKeys) {
      const list = grouped.get(ticket) || []
      if (!list.some(item => item.id === pr.id)) list.push(pr)
      grouped.set(ticket, list)
    }
  }
  return [...grouped.entries()].map(([ticket, items]) => ({ ticket, items }))
})

const stateLabel = (state: string) => (({
  open: 'Open',
  draft: 'Draft',
  merged: 'Merged',
  closed: 'Closed'
}) as Record<string, string>)[state] || state

const openPr = async (url: string) => {
  if (!/^https:\/\/github\.com\//i.test(url)) {
    uiStore.showError('The pull request URL is not a valid GitHub link.')
    return
  }
  try {
    await invoke('open_external_url', { url })
  } catch (error) {
    uiStore.showError(error instanceof Error ? error.message : 'Could not open pull request.')
  }
}
</script>

<style scoped>
.pr-panel { border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: var(--space-lg); }
header h2 { margin: 0 0 .25rem; }
header p, .pr-meta, .pr-description { color: var(--color-text-muted); }
header p { margin: 0 0 1rem; }
.ticket-group + .ticket-group { margin-top: 1.25rem; padding-top: 1rem; border-top: 1px solid var(--color-border); }
.ticket-group h3 { margin: 0 0 .6rem; font-size: 1rem; }
.ticket-group h3 a { color: var(--color-accent); text-decoration: none; }
.ticket-group h3 a:hover { text-decoration: underline; }
.pr-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; padding: .8rem 0; border-top: 1px solid var(--color-border); }
.pr-main { min-width: 0; }
.pr-title { color: var(--color-accent); font-weight: 650; text-decoration: none; }
.pr-title:hover { text-decoration: underline; }
.pr-meta, .pr-description { margin: .35rem 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: .9rem; }
.pr-description { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.muted { font-style: italic; }
.state { white-space: nowrap; border: 1px solid var(--color-border); border-radius: 999px; padding: .2rem .55rem; font-size: .8rem; text-transform: capitalize; }
.state-merged { border-color: var(--color-success); }
.state-closed { color: var(--color-text-muted); }
</style>
