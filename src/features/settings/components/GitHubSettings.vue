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
        {{ busy ? 'Connecting…' : 'Save token & test connection' }}
      </button>
      <button class="btn-secondary" type="button" :disabled="busy" @click="refresh">
        Test connection
      </button>
    </div>

    <p v-if="message" class="status-message" :class="{ error: failed }" role="status">{{ message }}</p>

  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { executeApi } from '@/shared/utils/api'

const token = ref('')
const busy = ref(false)
const message = ref('')
const failed = ref(false)
const status = ref({ connected: false, login: '' })
const refresh = async () => {
  busy.value = true
  failed.value = false
  try {
    const result = await executeApi<{ connected?: boolean; login?: string; message?: string }>('github_pr_connection_status')
    status.value = { connected: result.connected === true, login: result.login || '' }
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
    message.value = result.message || 'GitHub connected.'
    token.value = ''
  } catch (error) {
    failed.value = true
    message.value = error instanceof Error ? error.message : 'GitHub connection failed.'
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
</style>
