<template>
  <section v-if="pullRequests.length" class="pr-panel">
    <header>
      <h2>Related GitHub Pull Requests</h2>
      <p>Pull requests matching ticket keys from logged or planned work.</p>
    </header>
    <div class="pr-list">
      <PullRequestCard v-for="pr in uniquePullRequests" :key="pr.id" :pr="pr" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ScrumPullRequest } from '@/features/scrum/models/scrum'
import PullRequestCard from '@/features/pull-requests/components/PullRequestCard.vue'

const props = defineProps<{ pullRequests: ScrumPullRequest[] }>()

const uniquePullRequests = computed(() => {
  const seen = new Set<string>()
  return props.pullRequests.filter(pr => {
    if (seen.has(pr.id)) return false
    seen.add(pr.id)
    return true
  })
})
</script>

<style scoped>
.pr-panel { border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: var(--space-lg); }
.pr-panel > header { margin-bottom: 1rem; }
.pr-panel > header h2 { margin: 0 0 .25rem; }
.pr-panel > header p { margin: 0; color: var(--color-text-muted); }
.pr-list { display: grid; grid-template-columns: 1fr; gap: var(--space-md); }
</style>
