<template>
  <div class="scrum-page page-shell">
    <header class="page-header">
      <div class="header-titles">
        <h1>Daily Scrum</h1>
        <p class="page-subtitle">Your stand-up overview of yesterday's work, today's plan, blockers and related pull requests.</p>
      </div>
    </header>

    <div class="page-body scrum-body">
      <div v-if="error" class="error-banner">{{ error }}</div>

      <div v-if="isLoading" class="loading-state">Building your update...</div>

      <template v-else-if="report">
        <div class="scrum-days">
          <ScrumDayPanel :day="report.yesterday" label="Yesterday" />
          <ScrumPlannedPanel
            :planned="plannedToday"
            :meetings="report.today.entries.filter(entry => entry.fromCalendar)"
            @open-search="openSearch"
            @remove="removePlanned"
          />
        </div>

        <ScrumBlockersPanel :blockers="report.blockers" @resolve="resolveBlocker" />

        <GitHubPullRequestsPanel :pull-requests="report.pullRequests" />
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
import { useEntriesStore } from '@/shared/stores/entries'
import { localDate } from '@/shared/utils/dates'
import ScrumDayPanel from '@/features/scrum/components/ScrumDayPanel.vue'
import ScrumBlockersPanel from '@/features/scrum/components/ScrumBlockersPanel.vue'
import ScrumPlannedPanel from '@/features/scrum/components/ScrumPlannedPanel.vue'
import ScrumTicketSearch from '@/features/scrum/components/ScrumTicketSearch.vue'
import GitHubPullRequestsPanel from '@/features/scrum/components/GitHubPullRequestsPanel.vue'
import { useScrum, setExtraTickets } from '@/features/scrum/composables/useScrum'
import { usePlannedWork } from '@/features/scrum/composables/usePlannedWork'
import { executeApi } from '@/shared/utils/api'
import type { ScrumPlanItem } from '@/features/scrum/models/scrumPlanItem'
import type { JiraIssueResult } from '@/features/scrum/models/jiraIssueResult'

const { report, isLoading, error, load, resolveBlocker, refresh } = useScrum()
const { results, isSearching, isSaving, searchError, hasSearched, search, add, remove, reset } = usePlannedWork()

const isSearchOpen = ref(false)

// Drives the "Added" state in the search list so the same ticket cannot be
// queued twice from a stale result set.
const plannedKeys = computed(() => plannedToday.value.map(item => item.ticketId))

// Tickets assigned to you that Jira has In Progress count as planned without
// being added. They are looked up, not stored, so they drop off when the
// ticket moves on.
const inProgress = ref<ScrumPlanItem[]>([])

const loadInProgress = async () => {
  try {
    const result = await executeApi<Record<string, unknown>>('tempo_get_issues', {
      query: 'assignee = currentUser() AND status = "In Progress" ORDER BY updated DESC',
      limit: 20
    })
    const issues = Array.isArray(result?.issues) ? result.issues as Array<Record<string, unknown>> : []
    const date = report.value?.today.date ?? localDate()
    inProgress.value = issues.map((issue, index) => ({
      id: -(index + 1),
      date,
      ticketId: String(issue.key ?? ''),
      summary: issue.summary ? String(issue.summary) : null,
      status: issue.status ? String(issue.status) : null,
      automatic: true
    })).filter(item => item.ticketId)
  } catch {
    // Jira not set up or unreachable: only the tickets you added are shown.
    inProgress.value = []
  }
}

const plannedToday = computed<ScrumPlanItem[]>(() => {
  const chosen = report.value?.today.planned ?? []
  const keys = new Set(chosen.map(item => item.ticketId.toLowerCase()))
  return [...chosen, ...inProgress.value.filter(item => !keys.has(item.ticketId.toLowerCase()))]
})

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

const entriesStore = useEntriesStore()

// The first visit of the day pulls today's meetings from the calendar; later
// visits find them already there. A failed sync never blocks the page.
onMounted(async () => {
  try {
    await entriesStore.autoSyncCalendarIfEmpty(localDate())
  } catch {
    // Meetings are a bonus here; the report still loads without them.
  }
  await load()
  await loadInProgress()
  await setExtraTickets(inProgress.value.map(item => item.ticketId))
})
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
