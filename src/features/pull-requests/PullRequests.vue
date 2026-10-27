<template>
  <div class="pull-requests-page page-shell">
    <div class="page-header">
      <div>
        <h1>Pull Requests</h1>
        <p class="page-sub">Review GitHub pull requests linked to your account.</p>
      </div>
      <button class="btn-refresh" type="button" :disabled="loading || checkingConnection" @click="refresh">
        {{ loading || checkingConnection ? 'Loading…' : '↻ Refresh' }}
      </button>
    </div>

    <div class="page-body pull-requests-body">
    <div v-if="message" class="notice" :class="{ error: hasError }" role="status">{{ message }}</div>

    <section v-if="!connected && !checkingConnection" class="connect-card">
      <h2>Connect GitHub to view pull requests</h2>
      <p>Connect a read-only GitHub token in Settings to see pull requests you authored or have been involved in reviewing.</p>
      <router-link class="settings-link" to="/settings">Open Settings → GitHub</router-link>
    </section>

    <template v-if="connected">
      <div class="pr-toolbar">
        <label class="search-field">
          <span>Search</span>
          <input v-model="searchText" type="search" placeholder="Title, repository, author, branch…" />
        </label>
        <label>
          <span>Relationship</span>
          <select v-model="relationshipFilter">
            <option value="all">All relevant PRs</option>
            <option value="authored">Authored by me</option>
            <option value="review">Reviewing / reviewed</option>
          </select>
        </label>
        <label>
          <span>Status</span>
          <select v-model="stateFilter">
            <option value="all">All statuses</option>
            <option value="open">Open</option>
            <option value="draft">Draft</option>
            <option value="merged">Merged</option>
            <option value="closed">Closed</option>
          </select>
        </label>
      </div>

      <div class="summary-row">
        <span>{{ filteredPrs.length }} matching · showing {{ paginatedPrs.length }} on this page</span>
        <span v-if="login">Connected as @{{ login }}</span>
      </div>

      <div v-if="loading && !prsLoaded" class="empty-state" aria-live="polite">Loading pull requests…</div>
      <section v-else-if="prsLoaded && filteredPrs.length" class="pr-list" aria-label="Pull requests">
        <PullRequestCard v-for="pr in paginatedPrs" :key="pr.id" :pr="pr" />
        <nav v-if="pageCount > 1" class="pagination" aria-label="Pull request pages">
          <button type="button" class="btn-refresh" :disabled="currentPage === 1" @click="currentPage--">Previous</button>
          <span>Page {{ currentPage }} of {{ pageCount }}</span>
          <button type="button" class="btn-refresh" :disabled="currentPage === pageCount" @click="currentPage++">Next</button>
        </nav>
      </section>
      <div v-else-if="prsLoaded" class="empty-state">
        <h2>No pull requests match these filters</h2>
        <p>Try changing the search or filters. Pull requests are limited to those authored by you or connected to your review activity.</p>
      </div>
    </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { executeApi } from '@/shared/utils/api'
import PullRequestCard from '@/features/pull-requests/components/PullRequestCard.vue'

interface PullRequest {
  id: string
  number: number
  repository: string
  title: string
  description: string
  url: string
  author: string
  branch: string
  state: string
  isDraft: boolean
  requestedReviewer: boolean
  isAuthoredByAccount: boolean
  reviewedByAccount?: boolean
  matchedTicketKeys: string[]
  updatedAt: string | null
  commentCount?: number
  pendingReview?: boolean
}

const connected = ref(false)
const login = ref('')
const checkingConnection = ref(false)
const loading = ref(false)
const hasError = ref(false)
const message = ref('')
const prs = ref<PullRequest[]>([])
const prsLoaded = ref(false)
const searchText = ref('')
const relationshipFilter = ref('all')
const stateFilter = ref('all')
const currentPage = ref(1)
const pageSize = 10

const filteredPrs = computed(() => {
  const query = searchText.value.trim().toLowerCase()
  return prs.value.filter(pr => {
    const relationshipMatches = relationshipFilter.value === 'all'
      || (relationshipFilter.value === 'authored' && pr.isAuthoredByAccount)
      || (relationshipFilter.value === 'review' && !pr.isAuthoredByAccount && (pr.requestedReviewer || pr.reviewedByAccount))
    const stateMatches = stateFilter.value === 'all' || pr.state === stateFilter.value
    const searchMatches = !query || [pr.title, pr.repository, pr.author, pr.branch, String(pr.number)]
      .some(value => String(value || '').toLowerCase().includes(query))
    return relationshipMatches && stateMatches && searchMatches
  })
})

watch([searchText, relationshipFilter, stateFilter], () => { currentPage.value = 1 })

const pageCount = computed(() => Math.max(1, Math.ceil(filteredPrs.value.length / pageSize)))
const paginatedPrs = computed(() => filteredPrs.value.slice((currentPage.value - 1) * pageSize, currentPage.value * pageSize))

const loadPullRequests = async () => {
  loading.value = true
  hasError.value = false
  try {
    const result = await executeApi<{
      success?: boolean
      message?: string
      prs?: PullRequest[]
      diagnostics?: { searches?: Array<{ name: string; count: number; error?: string }>; candidateCount?: number
        detailFailures?: Array<{ repository: string; number: number; endpoint: string; message: string }> }
    }>('github_pr_list', {})
    if (result.success === false) {
      hasError.value = true
      message.value = result.message || 'GitHub could not load pull requests.'
      return
    }
    prs.value = Array.isArray(result.prs) ? result.prs : []
    currentPage.value = 1
    prsLoaded.value = true
    const diagnostics = result.diagnostics
    const failures = diagnostics?.detailFailures || []
    if (failures.length) {
      hasError.value = true
      const first = failures[0]
      message.value = `GitHub found ${diagnostics?.candidateCount || 0} candidate PR(s), but ${failures.length} detail request(s) failed. First failure: ${first.repository}#${first.number} (${first.endpoint}) — ${first.message}`
    } else if (diagnostics && (diagnostics.searches || []).some(search => 'error' in search && search.error)) {
      const failed = (diagnostics.searches || []).filter(search => 'error' in search && search.error)
      const counts = (diagnostics.searches || []).map(search => `${search.name}: ${search.count}`).join(', ')
      hasError.value = true
      message.value = prs.value.length
        ? `Loaded ${prs.value.length} pull request(s), but some GitHub searches failed (${failed.map(search => search.name).join(', ')}). ${counts}`
        : `Some GitHub searches failed (${failed.map(search => search.name).join(', ')}). ${counts}`
    } else if (!prs.value.length && diagnostics) {
      const counts = (diagnostics.searches || []).map(search => `${search.name}: ${search.count}`).join(', ')
      message.value = `No relevant pull requests returned. Search results — ${counts || 'none'}; candidates: ${diagnostics.candidateCount || 0}.`
    } else {
      message.value = ''
    }
  } catch (error) {
    hasError.value = true
    message.value = error instanceof Error ? error.message : 'Could not load pull requests.'
  } finally {
    loading.value = false
  }
}

const refresh = async () => {
  checkingConnection.value = true
  hasError.value = false
  try {
    const result = await executeApi<{ connected?: boolean; login?: string; message?: string }>('github_pr_connection_status')
    connected.value = result.connected === true
    login.value = result.login || ''
    if (connected.value) {
      message.value = ''
      await loadPullRequests()
    } else {
      prs.value = []
      prsLoaded.value = false
      message.value = result.message || ''
    }
  } catch (error) {
    hasError.value = true
    message.value = error instanceof Error ? error.message : 'Could not check the GitHub connection.'
  } finally {
    checkingConnection.value = false
  }
}

onMounted(refresh)
</script>

<style scoped>
.page-sub { margin: .35rem 0 0; color: var(--color-text-muted); }
.pull-requests-body { display: flex; flex-direction: column; gap: var(--space-lg); }
.pull-requests-body > .notice { margin: 0; }
.pull-requests-body > .connect-card { margin: 0; }
.pull-requests-body > .pr-toolbar { margin: 0; padding: 1rem; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); }
.pull-requests-body > .summary-row { margin: 0; }
.btn-refresh { padding: .65rem 1rem; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-control); color: var(--color-text); cursor: pointer; }
.btn-refresh:disabled { opacity: .6; cursor: wait; }
.notice { margin: 1rem 0; padding: .85rem 1rem; border: 1px solid var(--color-border); border-radius: var(--radius-md); color: var(--color-text-muted); overflow-wrap: anywhere; }
.notice.error { color: var(--color-danger); border-color: var(--color-danger); }
.connect-card { margin-top: 1.5rem; padding: 1.5rem; border: 1px solid var(--color-border); border-radius: var(--radius-md); }
.connect-card p { color: var(--color-text-muted); line-height: 1.5; }
.settings-link { color: var(--color-accent); }
.pr-toolbar { display: flex; flex-wrap: wrap; align-items: end; gap: 1rem; margin: 1.5rem 0 1rem; }
.pr-toolbar label { display: flex; flex-direction: column; gap: .35rem; color: var(--color-text-muted); font-size: .9rem; }
.pr-toolbar input, .pr-toolbar select { min-width: 12rem; max-width: 100%; padding: .6rem .7rem; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text); }
.pr-toolbar .search-field { flex: 1 1 18rem; }
.pr-toolbar .search-field input { width: 100%; box-sizing: border-box; }
.summary-row { display: flex; justify-content: space-between; flex-wrap: wrap; gap: .5rem; color: var(--color-text-muted); font-size: .9rem; margin-bottom: 1rem; }
.pr-list { display: grid; grid-template-columns: 1fr; gap: var(--space-md); }
.empty-state { margin-top: 1.5rem; padding: 2rem; text-align: center; border: 1px dashed var(--color-border); border-radius: var(--radius-md); color: var(--color-text-muted); }
.empty-state h2 { font-size: 1.1rem; color: var(--color-text); }
.pagination { display: flex; justify-content: center; align-items: center; gap: 1rem; margin-top: 1rem; color: var(--color-text-muted); }
@media (max-width: 700px) { .pr-toolbar { align-items: stretch; } .pr-toolbar label, .pr-toolbar input, .pr-toolbar select { width: 100%; min-width: 0; box-sizing: border-box; } }
</style>
