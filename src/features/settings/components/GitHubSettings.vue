<template>
  <section class="settings-section">
    <h2>GitHub Pull Requests</h2>
    <p class="description">
      Connect the GitHub account you want TimeLogger to track. Pull requests are shown only when
      that account authored them, is currently requested as a reviewer, or has reviewed them before. The integration is read-only.
    </p>

    <div class="connection-state" :class="{ connected: status.connected }">
      <strong>{{ status.connected ? 'Connected' : 'Not connected' }}</strong>
      <span v-if="status.connected"> as @{{ status.login }}</span>
      <span v-else> — add a token to connect.</span>
    </div>

    <div class="form-group">
      <label for="github-token">GitHub personal access token</label>
      <input
        id="github-token"
        v-model="token"
        type="password"
        autocomplete="new-password"
        placeholder="Paste a fine-grained token"
      />
      <small>
        Use a fine-grained token with read-only Metadata and Pull requests access for the repositories
        you want included. The token is stored locally and never shown again after saving.
      </small>
    </div>

    <div class="button-row">
      <button class="btn-primary" type="button" :disabled="busy || !token.trim()" @click="save">
        {{ busy ? 'Connecting…' : 'Connect GitHub' }}
      </button>
      <button v-if="status.connected" class="btn-secondary" type="button" :disabled="busy" @click="disconnect">
        Disconnect
      </button>
      <button class="btn-secondary" type="button" :disabled="busy" @click="refresh">
        Refresh status
      </button>
      <button v-if="status.connected" class="btn-secondary" type="button" :disabled="loadingPrs" @click="loadPullRequests">
        {{ loadingPrs ? 'Loading pull requests…' : 'Load pull request history' }}
      </button>
    </div>

    <p v-if="message" class="status-message" :class="{ error: failed }" role="status">{{ message }}</p>

    <section v-if="prsLoaded" class="history">
      <h3>Pull request history</h3>
      <div class="filters">
        <label>Type
          <select v-model="typeFilter">
            <option value="all">All relevant PRs</option>
            <option value="authored">Authored by me</option>
            <option value="review">Reviewing / reviewed</option>
          </select>
        </label>
        <label>Status
          <select v-model="statusFilter">
            <option value="all">All statuses</option>
            <option value="open">Open</option>
            <option value="draft">Draft</option>
            <option value="merged">Merged</option>
            <option value="closed">Closed</option>
          </select>
        </label>
      </div>
      <p v-if="!filteredPrs.length" class="form-hint">No pull requests match these filters.</p>
      <div v-for="group in prGroups" :key="group.status" class="pr-status-group">
        <h4>{{ statusLabel(group.status) }} ({{ group.items.length }})</h4>
        <article v-for="pr in group.items" :key="pr.id" class="pr-history-item">
          <a :href="pr.url" @click.prevent="openPr(pr.url)">{{ pr.title }}</a>
          <span class="pr-label">{{ pr.isAuthoredByAccount ? 'Authored by you' : pr.requestedReviewer ? 'Review requested' : 'Reviewed by you' }}</span>
          <small>{{ pr.repository }}#{{ pr.number }} · {{ pr.branch }}</small>
          <p>{{ pr.description || 'No description provided.' }}</p>
          <small v-if="pr.matchedTicketKeys.length">Tickets: {{ pr.matchedTicketKeys.join(', ') }}</small>
        </article>
      </div>
    </section>
    <div class="info-box">
      <strong>Read-only by design</strong>
      <p>TimeLogger only makes GitHub GET requests for pull-request details and review activity. It cannot create, edit, approve, review, merge or close pull requests.</p>
      <p>Review notifications are checked while TimeLogger is running. Alerts cannot be guaranteed while the app is closed.</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { executeApi } from '@/shared/utils/api'

const token = ref('')
const busy = ref(false)
const message = ref('')
const failed = ref(false)
const status = ref({ connected: false, login: '' })
interface PullRequest {
  id: string; number: number; repository: string; title: string; description: string; url: string
  author: string; branch: string; state: string; isDraft: boolean; requestedReviewer: boolean
  isAuthoredByAccount: boolean; reviewedByAccount?: boolean; ticketKeys: string[]; matchedTicketKeys: string[]
  updatedAt: string | null
}
const prs = ref<PullRequest[]>([])
const prsLoaded = ref(false)
const loadingPrs = ref(false)
const typeFilter = ref('all')
const statusFilter = ref('all')
const filteredPrs = computed(() => prs.value.filter(pr => {
  const typeMatches = typeFilter.value === 'all'
    || (typeFilter.value === 'authored' && pr.isAuthoredByAccount)
    || (typeFilter.value === 'review' && !pr.isAuthoredByAccount && (pr.requestedReviewer || pr.reviewedByAccount))
  return typeMatches && (statusFilter.value === 'all' || pr.state === statusFilter.value)
}))
const statusOrder = ['open', 'draft', 'merged', 'closed']
const prGroups = computed(() => statusOrder.map(status => ({ status, items: filteredPrs.value.filter(pr => pr.state === status) })).filter(group => group.items.length))
const statusLabel = (state: string) => (({ open: 'Open', draft: 'Draft', merged: 'Merged', closed: 'Closed' }) as Record<string, string>)[state] || state

const loadPullRequests = async () => {
  loadingPrs.value = true
  failed.value = false
  try {
    const result = await executeApi<{
      success?: boolean; message?: string; prs?: PullRequest[]
      diagnostics?: { searches?: Array<{ name: string; count: number }>; candidateCount?: number
        detailFailures?: Array<{ repository: string; number: number; endpoint: string; message: string }> }
    }>('github_pr_list', {})
    if (result.success === false) {
      failed.value = true
      message.value = result.message || 'GitHub could not search pull requests.'
      return
    }
    prs.value = Array.isArray(result.prs) ? result.prs : []
    prsLoaded.value = true
    const diagnostics = result.diagnostics
    const failures = diagnostics?.detailFailures || []
    if (failures.length) {
      failed.value = true
      const first = failures[0]
      message.value = `GitHub found ${diagnostics?.candidateCount || 0} candidate PR(s), but ${failures.length} detail request(s) failed. First failure: ${first.repository}#${first.number} (${first.endpoint}) — ${first.message}`
    } else if (!prs.value.length && diagnostics) {
      const counts = (diagnostics.searches || []).map(search => `${search.name}: ${search.count}`).join(', ')
      message.value = `No relevant pull requests returned. Search results — ${counts || 'none'}; candidates: ${diagnostics.candidateCount || 0}.`
    }
  } catch (error) {
    failed.value = true
    message.value = error instanceof Error ? error.message : 'Could not load pull request history.'
  } finally {
    loadingPrs.value = false
  }
}

const openPr = async (url: string) => {
  if (!/^https:\/\/github\.com\//i.test(url)) return
  try { await invoke('open_external_url', { url }) }
  catch (error) { failed.value = true; message.value = error instanceof Error ? error.message : 'Could not open pull request.' }
}

const refresh = async () => {
  busy.value = true
  failed.value = false
  try {
    const result = await executeApi<{ connected?: boolean; login?: string; message?: string }>('github_pr_connection_status')
    status.value = { connected: result.connected === true, login: result.login || '' }
    if (!status.value.connected) { prs.value = []; prsLoaded.value = false }
    message.value = result.message || ''
    failed.value = result.connected === false && Boolean(result.message && !result.message.includes('No GitHub token configured'))
  } catch (error) {
    failed.value = true
    message.value = error instanceof Error ? error.message : 'Could not check GitHub connection.'
  } finally {
    busy.value = false
  }
}

const save = async () => {
  if (!token.value.trim()) return
  busy.value = true
  failed.value = false
  try {
    const result = await executeApi<{ connected?: boolean; login?: string; message?: string }>('github_pr_save_token', { token: token.value.trim() })
    status.value = { connected: result.connected === true, login: result.login || '' }
    prs.value = []
    prsLoaded.value = false
    message.value = result.message || 'GitHub connected.'
    token.value = ''
  } catch (error) {
    failed.value = true
    message.value = error instanceof Error ? error.message : 'GitHub connection failed.'
  } finally {
    busy.value = false
  }
}

const disconnect = async () => {
  busy.value = true
  failed.value = false
  try {
    const result = await executeApi<{ connected?: boolean; message?: string }>('github_pr_save_token', { token: '' })
    status.value = { connected: false, login: '' }
    prs.value = []
    prsLoaded.value = false
    message.value = result.message || 'GitHub disconnected.'
  } catch (error) {
    failed.value = true
    message.value = error instanceof Error ? error.message : 'Could not disconnect GitHub.'
  } finally {
    busy.value = false
  }
}

onMounted(refresh)
</script>

<style scoped>
.description { color: var(--color-text-muted); line-height: 1.5; max-width: 58rem; }
.connection-state { padding: .8rem 1rem; margin: 1rem 0; border: 1px solid var(--color-border); border-radius: var(--radius-md); }
.connection-state.connected { border-color: var(--color-success); }
.form-group { display: flex; flex-direction: column; gap: .4rem; max-width: 44rem; margin: 1rem 0; }
.form-group small { color: var(--color-text-muted); line-height: 1.45; }
.button-row { display: flex; flex-wrap: wrap; gap: .75rem; }
.status-message { margin-top: 1rem; }
.status-message.error { color: var(--color-danger); }
.info-box { margin-top: 1.5rem; padding: 1rem; border: 1px solid var(--color-border); border-radius: var(--radius-md); max-width: 58rem; }
.info-box p { margin: .5rem 0 0; color: var(--color-text-muted); }
.history { margin-top: 2rem; }
.filters { display: flex; gap: 1rem; flex-wrap: wrap; margin: .75rem 0 1rem; }
.filters label { display: flex; flex-direction: column; gap: .3rem; }
.filters select { min-width: 12rem; padding: .5rem; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text); }
.pr-status-group { margin-top: 1.25rem; }
.pr-status-group h4 { margin-bottom: .5rem; }
.pr-history-item { padding: .8rem 0; border-top: 1px solid var(--color-border); display: grid; gap: .3rem; }
.pr-history-item a { color: var(--color-accent); font-weight: 650; text-decoration: none; }
.pr-history-item a:hover { text-decoration: underline; }
.pr-history-item small, .pr-history-item p { color: var(--color-text-muted); overflow-wrap: anywhere; margin: 0; }
.pr-label { justify-self: start; border: 1px solid var(--color-border); border-radius: 999px; padding: .15rem .5rem; font-size: .8rem; }
</style>
