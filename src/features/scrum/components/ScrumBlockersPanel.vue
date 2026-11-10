<template>
  <section class="scrum-blockers" :class="{ 'has-blockers': blockers.length > 0 }">
    <header class="blockers-header">
      <h3>Blockers</h3>
      <span class="blockers-count">{{ blockers.length }}</span>
    </header>

    <p v-if="blockers.length === 0" class="blockers-empty">
      No open blockers. Tick "This is a blocker" when adding a note to raise one.
    </p>

    <ul v-else class="blockers-list">
      <li v-for="blocker in blockers" :key="blocker.id" class="blocker">
        <div class="blocker-body">
          <div class="blocker-meta">
            <JiraTicketLink v-if="blocker.ticketId" class="blocker-ticket" :ticket-id="blocker.ticketId" />
            <strong v-if="blocker.title" class="blocker-title">{{ blocker.title }}</strong>
            <span class="blocker-age">{{ ageLabel(blocker.date) }}</span>
          </div>
          <p class="blocker-note">{{ blocker.note }}</p>
          <div v-if="blocker.pullRequests.length" class="blocker-prs">
            <h4>Related pull requests</h4>
            <PullRequestCard v-for="pr in blocker.pullRequests" :key="pr.id" :pr="pr" />
          </div>
        </div>
        <button type="button" class="blocker-resolve" @click="emit('resolve', blocker.id)">
          Resolve
        </button>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import JiraTicketLink from '@/features/scrum/components/JiraTicketLink.vue'
import PullRequestCard from '@/features/pull-requests/components/PullRequestCard.vue'
import type { ScrumBlocker } from '@/features/scrum/models/scrum'

defineProps<{ blockers: ScrumBlocker[] }>()
const emit = defineEmits<{ resolve: [id: number] }>()

/**
 * How long a blocker has been open. Age is the point of showing it: a blocker
 * carried for several days is the one worth raising loudest at stand-up.
 */
const ageLabel = (date: string) => {
  const raised = new Date(`${date}T00:00:00`)
  if (Number.isNaN(raised.getTime())) return ''
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.round((today.getTime() - raised.getTime()) / 86400000)
  if (days <= 0) return 'raised today'
  if (days === 1) return 'open 1 day'
  return `open ${days} days`
}
</script>

<style scoped>
.scrum-blockers {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 0.75rem;
  padding: 1.25rem;
}

.scrum-blockers.has-blockers {
  border-color: var(--color-warning);
}

.blockers-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.blockers-header h3 {
  margin: 0;
  font-size: 1rem;
}

.blockers-count {
  font-size: 0.75rem;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  background: var(--color-border);
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.has-blockers .blockers-count {
  background: var(--color-warning);
  color: #1f2937;
}

.blockers-empty {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.9rem;
}

.blockers-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.blocker {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--color-border);
}

.blocker:last-child {
  border-bottom: none;
}

.blocker-body {
  flex: 1;
  min-width: 0;
}

.blocker-meta {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.blocker-ticket {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: var(--color-accent);
}

.blocker-title {
  font-size: 0.9rem;
  overflow-wrap: anywhere;
}

.blocker-note {
  margin: 0.25rem 0 0;
  font-size: 0.9rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.blocker-prs {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.blocker-prs h4 {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.blocker-age {
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.blocker-resolve {
  flex-shrink: 0;
  padding: 0.3rem 0.7rem;
  font-size: 0.8rem;
  border-radius: 0.4rem;
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
}

.blocker-resolve:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
</style>
