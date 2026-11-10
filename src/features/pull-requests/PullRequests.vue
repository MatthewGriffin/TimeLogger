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
    <div v-else-if="loadNotice" class="notice error" role="status">{{ loadNotice }}</div>

    <section v-if="!connected && !checkingConnection" class="connect-card">
      <h2>Connect GitHub to view pull requests</h2>
      <p>Connect a read-only GitHub token in Settings to see pull requests you authored, have been involved in reviewing, or are mentioned in.</p>
      <router-link class="settings-link" to="/settings">Open Settings → GitHub</router-link>
    </section>

    <template v-if="connected">
      <div class="pr-toolbar">
        <label>
          <span>Relationship</span>
          <select v-model="relationshipFilter">
            <option value="all">All relevant PRs</option>
            <option value="authored">Authored by me</option>
            <option value="review">Reviewing / reviewed</option>
            <option value="mentioned">Mentioning me</option>
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
        <span aria-live="polite">Page {{ currentPage }} · showing {{ filteredPrs.length }}<template v-if="loading"> · loading from GitHub…</template></span>
        <span v-if="login">Connected as @{{ login }}</span>
      </div>

      <div v-if="loading && !filteredPrs.length" class="empty-state" aria-live="polite">Loading pull requests…</div>
      <section v-else-if="prsLoaded && (filteredPrs.length || currentPage > 1)" class="pr-list" :aria-busy="loading" aria-label="Pull requests">
        <PullRequestCard v-for="pr in filteredPrs" :key="pr.id" :pr="pr" />
        <p v-if="!filteredPrs.length" class="empty-page">Nothing on this page. Go back to the previous page.</p>
        <nav v-if="currentPage > 1 || hasMore" class="pagination" aria-label="Pull request pages">
          <button type="button" class="btn-refresh" :disabled="currentPage === 1 || loading" @click="currentPage--">Previous</button>
          <span>Page {{ currentPage }}</span>
          <button type="button" class="btn-refresh" :disabled="!hasMore || loading" @click="currentPage++">Next</button>
        </nav>
      </section>
      <div v-else-if="prsLoaded" class="empty-state">
        <h2>No pull requests match these filters</h2>
        <p>Try changing the filters. Pull requests are limited to those authored by you, connected to your review activity, or mentioning you.</p>
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
  mentionsAccount?: boolean
  matchedTicketKeys: string[]
  updatedAt: string | null
  commentCount?: number
  pendingReview?: boolean
}

interface PullRequestListResult {
  success?: boolean
  message?: string
  prs?: PullRequest[]
  hasMore?: boolean
  diagnostics?: { searches?: Array<{ name: string; count: number; error?: string }>; candidateCount?: number
    detailFailures?: Array<{ repository: string; number: number; endpoint: string; message: string }> }
}

// Only the pull requests on the page are loaded from GitHub, so a small page keeps it quick.
const PAGE_SIZE = 3

const connected = ref(false)
const login = ref('')
const checkingConnection = ref(false)
const hasError = ref(false)
const message = ref('')
const relationshipFilter = ref('all')
const stateFilter = ref('open')
const currentPage = ref(1)

const prs = ref<PullRequest[]>([])
const prsLoaded = ref(false)
const loading = ref(false)
const loadNotice = ref('')
const hasMore = ref(false)

const describeProblems = (result: PullRequestListResult): string => {
  const diagnostics = result.diagnostics
  const searches = diagnostics?.searches || []
  const failures = diagnostics?.detailFailures || []
  if (failures.length) {
    const first = failures[0]
    return `GitHub found ${diagnostics?.candidateCount || 0} candidate PR(s), but ${failures.length} detail request(s) failed. First failure: ${first.repository}#${first.number} (${first.endpoint}) — ${first.message}`
  }
  const failed = searches.filter(search => search.error)
  if (failed.length) {
    const counts = searches.map(search => `${search.name}: ${search.count}`).join(', ')
    const reason = String(failed[0].error || '').replace(/^GitHub API request faileds*/, '').slice(0, 200)
    return `Some GitHub searches failed (${failed.map(search => search.name).join(', ')}). ${counts}${reason ? ` First error: ${reason}` : ''}`
  }
  if (!result.prs?.length && diagnostics?.candidateCount) {
    return `GitHub found ${diagnostics.candidateCount} candidate PR(s), but none could be confirmed as linked to your account.`
  }
  return ''
}

// The page asks GitHub for its own pull requests only, so these are all it shows.
// They are still checked against the filters, in case GitHub's search index is
// behind and returns one with another status.
const filteredPrs = computed(() => prs.value.filter(pr => {
  const relationshipMatches = relationshipFilter.value === 'all'
    || (relationshipFilter.value === 'authored' && pr.isAuthoredByAccount)
    || (relationshipFilter.value === 'review' && !pr.isAuthoredByAccount && (pr.requestedReviewer || pr.reviewedByAccount))
    || (relationshipFilter.value === 'mentioned' && !pr.isAuthoredByAccount && pr.mentionsAccount)
  const stateMatches = stateFilter.value === 'all' || pr.state === stateFilter.value
  return relationshipMatches && stateMatches
}))

// A newer request makes any response still in flight stale, so a slow reply
// can't replace the page the user has moved to.
let latest = 0
// Set when Refresh moves back to the first page, whose load then skips the cache.
let forceRefresh = false
const loadPage = async (refresh = false) => {
  const request = ++latest
  const bypassCache = refresh || forceRefresh
  forceRefresh = false
  loading.value = true
  try {
    const result = await executeApi<PullRequestListResult>('github_pr_list', {
      relationship: relationshipFilter.value,
      state: stateFilter.value,
      page: currentPage.value,
      pageSize: PAGE_SIZE,
      refresh: bypassCache
    })
    if (request !== latest) return
    if (result.success === false) {
      loadNotice.value = result.message || 'GitHub could not load pull requests.'
      return
    }
    prs.value = Array.isArray(result.prs) ? result.prs : []
    hasMore.value = result.hasMore === true
    prsLoaded.value = true
    loadNotice.value = describeProblems(result)
  } catch (error) {
    if (request === latest) loadNotice.value = error instanceof Error ? error.message : 'Could not load pull requests.'
  } finally {
    if (request === latest) loading.value = false
  }
}

const resetResults = () => {
  latest++
  prs.value = []
  prsLoaded.value = false
  loading.value = false
  hasMore.value = false
  loadNotice.value = ''
}

watch(currentPage, () => { if (connected.value) void loadPage() })

// Changing a filter starts again from the first page. Moving the page number is
// what loads, so it isn't loaded twice when it was already there.
watch([relationshipFilter, stateFilter], () => {
  if (!connected.value) return
  if (currentPage.value !== 1) currentPage.value = 1
  else void loadPage()
})

const refresh = async () => {
  checkingConnection.value = true
  hasError.value = false
  try {
    const result = await executeApi<{ connected?: boolean; login?: string; message?: string }>('github_pr_connection_status')
    connected.value = result.connected === true
    login.value = result.login || ''
    if (connected.value) {
      message.value = ''
      // Refresh asks GitHub again rather than reusing results kept for a minute.
      if (currentPage.value !== 1) {
        forceRefresh = true
        currentPage.value = 1
      } else {
        await loadPage(true)
      }
    } else {
      resetResults()
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
.summary-row { display: flex; justify-content: space-between; flex-wrap: wrap; gap: .5rem; color: var(--color-text-muted); font-size: .9rem; margin-bottom: 1rem; }
.pr-list { display: grid; grid-template-columns: 1fr; gap: var(--space-md); }
.empty-state { margin-top: 1.5rem; padding: 2rem; text-align: center; border: 1px dashed var(--color-border); border-radius: var(--radius-md); color: var(--color-text-muted); }
.empty-state h2 { font-size: 1.1rem; color: var(--color-text); }
.empty-page { margin: 0; color: var(--color-text-muted); text-align: center; }
.pagination { display: flex; justify-content: center; align-items: center; gap: 1rem; margin-top: 1rem; color: var(--color-text-muted); }
@media (max-width: 700px) { .pr-toolbar { align-items: stretch; } .pr-toolbar label, .pr-toolbar input, .pr-toolbar select { width: 100%; min-width: 0; box-sizing: border-box; } }
</style>
