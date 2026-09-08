<template>
  <div class="search-overlay" @click.self="emit('close')">
    <div class="search-dialog" role="dialog" aria-modal="true" aria-labelledby="ticket-search-title">
      <header class="search-header">
        <h3 id="ticket-search-title">Add planned work</h3>
        <button type="button" class="search-close" aria-label="Close" @click="emit('close')">×</button>
      </header>

      <p class="search-hint">
        Your open Jira tickets. Adding one records what you intend to work on &mdash; it logs no
        time and is never submitted to Tempo.
      </p>

      <form class="search-form" @submit.prevent="runSearch">
        <input
          ref="searchInput"
          v-model="term"
          type="search"
          class="search-input"
          placeholder="Filter by key or summary, or leave blank for all"
          aria-label="Search your Jira tickets"
        />
        <button type="submit" class="search-btn" :disabled="isSearching">
          {{ isSearching ? 'Searching…' : 'Search' }}
        </button>
      </form>

      <p v-if="searchError" class="search-error">{{ searchError }}</p>

      <div v-if="isSearching" class="search-state">Searching Jira…</div>

      <p v-else-if="hasSearched && results.length === 0" class="search-state">
        No open tickets assigned to you matched.
      </p>

      <ul v-else-if="results.length > 0" class="search-results">
        <li v-for="issue in results" :key="issue.key" class="search-result">
          <div class="result-body">
            <span class="result-key">{{ issue.key }}</span>
            <span class="result-summary">{{ issue.summary }}</span>
            <span v-if="issue.status" class="result-status">{{ issue.status }}</span>
          </div>
          <button
            type="button"
            class="result-add"
            :disabled="isSaving || plannedKeys.includes(issue.key)"
            @click="emit('add', issue)"
          >
            {{ plannedKeys.includes(issue.key) ? 'Added' : 'Add' }}
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { JiraIssueResult } from '@/features/scrum/models/jiraIssueResult'

const props = defineProps<{
  results: JiraIssueResult[]
  isSearching: boolean
  isSaving: boolean
  searchError: string
  hasSearched: boolean
  plannedKeys: string[]
}>()

const emit = defineEmits<{
  search: [term: string]
  add: [issue: JiraIssueResult]
  close: []
}>()

const term = ref('')
const searchInput = ref<HTMLInputElement | null>(null)

const runSearch = () => emit('search', term.value)

// Open with the user's current tickets already listed. Requiring a search
// first would be busywork: the common case is picking from what is assigned.
onMounted(() => {
  searchInput.value?.focus()
  if (!props.hasSearched) emit('search', '')
})
</script>

<style scoped>
.search-overlay {
  position: fixed;
  inset: 0;
  background: var(--color-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-lg);
  z-index: 100;
}

.search-dialog {
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-lg);
  padding: var(--space-lg);
  width: min(640px, 100%);
  max-height: 80vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.search-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
}

.search-header h3 {
  margin: 0;
  font-size: 1rem;
}

.search-close {
  background: none;
  border: none;
  color: var(--color-text-subtle);
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
  padding: 0 var(--space-2xs);
}

.search-close:hover {
  color: var(--color-text);
}

.search-hint {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}

.search-form {
  display: flex;
  gap: var(--space-xs);
}

.search-input {
  flex: 1;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface);
  color: var(--color-text);
  font-family: inherit;
  font-size: 0.9rem;
}

.search-input:focus {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 1px;
  border-color: var(--color-accent);
}

.search-btn {
  padding: var(--space-xs) var(--space-md);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-accent);
  background: var(--color-accent);
  color: var(--color-on-accent);
  font-weight: 600;
  font-size: 0.9rem;
  cursor: pointer;
}

.search-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.search-error {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-danger-soft);
}

.search-state {
  margin: 0;
  padding: var(--space-md) 0;
  color: var(--color-text-muted);
  font-size: 0.9rem;
}

.search-results {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.search-result {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-sm) 0;
  border-bottom: 1px solid var(--color-border);
}

.search-result:last-child {
  border-bottom: none;
}

.result-body {
  display: flex;
  align-items: baseline;
  gap: var(--space-xs);
  flex-wrap: wrap;
  min-width: 0;
}

.result-key {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: var(--color-accent);
}

.result-summary {
  font-size: 0.9rem;
}

.result-status {
  font-size: 0.72rem;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  background: var(--color-control);
  color: var(--color-text-subtle);
}

.result-add {
  flex-shrink: 0;
  padding: var(--space-2xs) var(--space-sm);
  font-size: 0.8rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-accent-ring);
  background: var(--color-accent-soft);
  color: var(--color-accent);
  cursor: pointer;
}

.result-add:hover:not(:disabled) {
  background: var(--color-accent-muted);
}

.result-add:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
