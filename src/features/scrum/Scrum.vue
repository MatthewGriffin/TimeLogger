<template>
  <div class="scrum-page page-shell">
    <header class="page-header">
      <div class="header-titles">
        <h1>Daily Scrum</h1>
        <p class="page-subtitle">Your update for stand-up, built from your logged time and notes.</p>
      </div>
    </header>

    <div class="page-body scrum-body">
      <div v-if="error" class="error-banner">{{ error }}</div>

      <div v-if="isLoading" class="loading-state">Building your update...</div>

      <template v-else-if="report">
        <ScrumSummaryCard
          :summary="report.summary"
          :source="report.summarySource"
          :regenerating="isRegenerating"
          @regenerate="regenerate(true)"
        />

        <div class="scrum-days">
          <ScrumDayPanel :day="report.yesterday" label="Yesterday" />
          <ScrumDayPanel :day="report.today" label="Today" />
        </div>

        <ScrumPlannedPanel
          :planned="report.today.planned"
          @open-search="openSearch"
          @remove="removePlanned"
        />

        <ScrumBlockersPanel :blockers="report.blockers" @resolve="resolveBlocker" />
      </template>
    </div>

    <ScrumTicketSearch
      v-if="isSearchOpen && report"
      :results="results"
      :is-searching="isSearching"
      :is-saving="isSaving"
      :search-error="searchError"
      :has-searched="hasSearched"
      :planned-keys="plannedKeys"
      @search="search"
      @add="addPlanned"
      @close="isSearchOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import ScrumSummaryCard from '@/features/scrum/components/ScrumSummaryCard.vue'
import ScrumDayPanel from '@/features/scrum/components/ScrumDayPanel.vue'
import ScrumBlockersPanel from '@/features/scrum/components/ScrumBlockersPanel.vue'
import ScrumPlannedPanel from '@/features/scrum/components/ScrumPlannedPanel.vue'
import ScrumTicketSearch from '@/features/scrum/components/ScrumTicketSearch.vue'
import { useScrum } from '@/features/scrum/composables/useScrum'
import { usePlannedWork } from '@/features/scrum/composables/usePlannedWork'
import type { JiraIssueResult } from '@/features/scrum/models/jiraIssueResult'

const { report, isLoading, isRegenerating, error, load, regenerate, resolveBlocker, refresh } = useScrum()
const { results, isSearching, isSaving, searchError, hasSearched, search, add, remove, reset } = usePlannedWork()

const isSearchOpen = ref(false)

// Drives the "Added" state in the search list so the same ticket cannot be
// queued twice from a stale result set.
const plannedKeys = computed(() => report.value?.today.planned.map(item => item.ticketId) ?? [])

const openSearch = () => {
  reset()
  isSearchOpen.value = true
}

const addPlanned = async (issue: JiraIssueResult) => {
  if (!report.value) return
  const added = await add(issue, report.value.today.date)
  if (added) await refresh()
}

const removePlanned = async (id: number) => {
  if (await remove(id)) await refresh()
}

// The first load skips the model so the page paints immediately; the AI
// paragraph is a deliberate click, since generation can take a few seconds.
onMounted(() => load(false))
</script>

<style scoped>
.scrum-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

.page-header h1 {
  margin: 0 0 var(--space-2xs);
}

.page-subtitle {
  margin: 0;
  color: var(--color-text-muted);
}

.scrum-days {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: var(--space-lg);
}

.loading-state {
  padding: var(--space-xl);
  text-align: center;
  color: var(--color-text-muted);
}

.error-banner {
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: var(--color-danger);
}
</style>
