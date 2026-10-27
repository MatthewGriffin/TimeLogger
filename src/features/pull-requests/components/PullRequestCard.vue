<template>
  <article class="pr-card">
    <div class="pr-card-top">
      <span class="state-pill" :class="'state-' + pr.state">{{ statusLabel(pr.state) }}</span>
      <span class="pr-number">{{ pr.repository }}#{{ pr.number }}</span>
      <span v-if="showRelationship" class="pr-relationship">{{ relationshipLabel(pr) }}</span>
    </div>
    <h2><a :href="pr.url" @click.prevent="openPr(pr.url)">{{ pr.title }}</a></h2>
    <p class="pr-description">{{ pr.description || 'No description provided.' }}</p>
    <div class="pr-meta">
      <span>Author: @{{ pr.author || 'unknown' }}</span>
      <span v-if="pr.branch">Branch: {{ pr.branch }}</span>
      <span v-if="pr.updatedAt">Updated {{ formatDate(pr.updatedAt) }}</span>
      <span v-if="pr.commentCount !== undefined" class="pr-comment-count" :title="`${pr.commentCount || 0} comments`">💬 {{ pr.commentCount || 0 }}</span>
      <span v-if="pr.pendingReview" class="pr-pending-review" title="Review requested" aria-label="Review requested">⚑ Review needed</span>
    </div>
    <div v-if="pr.matchedTicketKeys.length" class="ticket-keys">
      <span v-for="ticket in pr.matchedTicketKeys" :key="ticket" class="ticket-chip">{{ ticket }}</span>
    </div>
    <div class="pr-card-footer">
      <a :href="pr.url" @click.prevent="openPr(pr.url)">View on GitHub ↗</a>
    </div>
  </article>
</template>

<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core'
import { useUiStore } from '@/shared/stores/ui'

interface PullRequestCardData {
  id: string
  number: number
  repository: string
  title: string
  description: string
  url: string
  author: string
  branch: string
  state: string
  isAuthoredByAccount: boolean
  requestedReviewer: boolean
  reviewedByAccount?: boolean
  matchedTicketKeys: string[]
  updatedAt: string | null
  commentCount?: number
  pendingReview?: boolean
}

withDefaults(defineProps<{
  pr: PullRequestCardData
  showRelationship?: boolean
}>(), {
  showRelationship: true
})

const uiStore = useUiStore()

const statusLabel = (state: string) =>
  (({ open: 'Open', draft: 'Draft', merged: 'Merged', closed: 'Closed' }) as Record<string, string>)[state] || state

const relationshipLabel = (pr: PullRequestCardData) => pr.isAuthoredByAccount
  ? 'Authored by you'
  : pr.requestedReviewer
    ? 'Review requested'
    : 'Reviewed by you'

const formatDate = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

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
.pr-card { min-width: 0; padding: 1.25rem; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface-raised); }
.pr-card-top { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; font-size: .82rem; }
.state-pill { padding: .2rem .55rem; border-radius: 999px; border: 1px solid var(--color-border); font-weight: 600; }
.state-open { color: var(--color-success); }
.state-draft { color: var(--color-text-muted); }
.state-merged { color: var(--color-accent); }
.state-closed { color: var(--color-danger); }
.pr-number, .pr-relationship { color: var(--color-text-muted); }
.pr-card h2 { font-size: 1.08rem; line-height: 1.4; margin: .5rem 0; overflow-wrap: anywhere; }
.pr-card h2 a, .pr-card-footer a { color: var(--color-accent); text-decoration: none; }
.pr-card h2 a:hover, .pr-card-footer a:hover { text-decoration: underline; }
.pr-description { color: var(--color-text-muted); line-height: 1.5; white-space: pre-line; overflow-wrap: anywhere; margin: .5rem 0 .75rem; }
.pr-meta { display: flex; flex-wrap: wrap; gap: .5rem 1rem; font-size: .83rem; color: var(--color-text-muted); }
.ticket-keys { display: flex; flex-wrap: wrap; gap: .35rem; margin-top: .75rem; }
.ticket-chip { border-radius: .3rem; padding: .15rem .4rem; background: var(--color-control); font-size: .8rem; }
.pr-card-footer { margin-top: 1rem; padding-top: .75rem; border-top: 1px solid var(--color-border); font-size: .9rem; }
.pr-pending-review { color: var(--color-warning, #b7791f); font-weight: 600; }
</style>
