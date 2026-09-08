<template>
  <div class="setup-wizard">
    <header class="wizard-header">
      <h1>TimeLogger Setup</h1>
      <p class="subtitle">Connect Jira, Microsoft, and Ollama to unlock the full desktop experience.</p>
    </header>

    <div class="progress-container">
      <div class="progress-bar"><div class="progress-fill" :style="{ width: progressPercent + '%' }"></div></div>
      <p class="progress-text">Step {{ currentStep }} / {{ totalSteps }}</p>
    </div>

    <div class="steps-container">
      <section v-if="currentStep === 1" class="step">
        <h2>Welcome to TimeLogger!</h2>
        <p>This wizard will help you set up Jira, Microsoft, and Ollama.</p>
        <ul class="feature-list">
          <li>Jira + Tempo time tracking</li>
          <li>Microsoft calendar and notes</li>
          <li>Local Ollama-powered AI features</li>
          <li>Auto-start on Windows login</li>
        </ul>
        <div class="step-actions">
          <button class="btn btn-primary" @click="goToNextStep">Get Started</button>
        </div>
      </section>

      <section v-if="currentStep === 2" class="step" :key="`jira-${hydrationTick}`">
        <h2>Jira & Tempo Configuration</h2>
        <div class="form-stack">
          <label class="field"><span>Jira Base URL</span><input v-model="config.jiraBaseUrl" type="url" placeholder="https://your-domain.atlassian.net" /></label>
          <label class="field"><span>Jira Email</span><input v-model="config.jiraEmail" type="email" placeholder="your.email@company.com" /></label>
          <div class="field-row">
            <label class="field"><span>Jira API Token</span><input v-model="config.jiraApiToken" type="text" placeholder="API token" autocomplete="off" /></label>
            <label class="field"><span>Tempo API Token</span><input v-model="config.tempoApiToken" type="text" placeholder="Tempo token" autocomplete="off" /></label>
          </div>
        </div>
        <div class="inline-actions">
          <button class="btn btn-secondary" :disabled="testingJira" @click="testJiraConnection">{{ testingJira ? 'Testing…' : 'Test Connection' }}</button>
          <div v-if="jiraTestResult" :class="['status-chip', jiraTestResult.success ? 'success' : 'error']">{{ jiraTestResult.message }}</div>
        </div>
        <div class="step-actions">
          <button class="btn btn-ghost" @click="goToPrevStep">Back</button>
          <button class="btn btn-primary" :disabled="!canProceedToNext" @click="goToNextStep">Next</button>
        </div>
      </section>

      <section v-if="currentStep === 3" class="step">
        <h2>Microsoft Integration</h2>
        <div class="form-stack">
          <label class="field"><span>Tenant ID</span><input v-model="config.graphTenantId" type="text" placeholder="tenant id" /></label>
          <div class="field-row">
            <label class="field"><span>Client ID</span><input v-model="config.graphClientId" type="text" placeholder="client id" /></label>
            <label class="field"><span>Client Secret</span><input v-model="config.graphClientSecret" type="text" placeholder="blank for public client" autocomplete="off" /></label>
          </div>
        </div>
        <label class="checkline"><input v-model="config.skipMicrosoft" type="checkbox" /><span>Skip Microsoft integration for now</span></label>
        <div class="inline-actions">
          <button class="btn btn-secondary" :disabled="testingGraph" @click="testGraphConnection">{{ testingGraph ? 'Testing…' : 'Test Connection' }}</button>
          <div v-if="microsoftSaved" class="status-chip success">Microsoft saved</div>
          <div v-if="graphTestResult" :class="['status-chip', graphTestResult.success ? 'success' : 'error']">
            {{ graphTestResult.message }}
            <button
              v-if="graphTestResult.success && !microsoftSaved"
              type="button"
              class="login-link"
              @click="openMicrosoftSignIn"
            >
              Open Microsoft sign-in
            </button>
            <div v-if="graphTestResult.redirectUri" class="redirect-hint">
              You’ll be sent back to {{ graphTestResult.redirectUri }} after signing in.
            </div>
          </div>
        </div>
        <div class="step-actions">
          <button class="btn btn-ghost" @click="goToPrevStep">Back</button>
          <button class="btn btn-primary" @click="goToNextStep">Next</button>
        </div>
      </section>

      <section v-if="currentStep === 4" class="step">
        <h2>Ollama LLM Configuration</h2>
        <div class="form-stack">
          <label class="field"><span>Host</span><input v-model="config.ollamaHost" type="url" placeholder="http://localhost:11434" /></label>
          <label class="field">
            <span>Default Model</span>
            <select v-model="config.ollamaModel">
              <option value="">Auto-detect</option>
              <option v-for="model in availableOllamaModels" :key="model" :value="model">{{ model }}</option>
            </select>
          </label>
        </div>
        <label class="checkline"><input v-model="config.skipOllama" type="checkbox" /><span>Skip Ollama for now</span></label>
        <div class="inline-actions">
          <button class="btn btn-secondary" :disabled="testingOllama" @click="testOllamaConnection">{{ testingOllama ? 'Testing…' : 'Test Connection' }}</button>
          <div v-if="ollamaTestResult" :class="['status-chip', ollamaTestResult.success ? 'success' : 'error']">{{ ollamaTestResult.message }}</div>
        </div>
        <div class="step-actions">
          <button class="btn btn-ghost" @click="goToPrevStep">Back</button>
          <button class="btn btn-primary" @click="goToNextStep">Next</button>
        </div>
      </section>

      <section v-if="currentStep === 5" class="step">
        <h2>Review Configuration</h2>
        <div class="review-grid">
          <div class="review-block"><span>Jira</span><strong>{{ config.jiraBaseUrl || 'Not set' }}</strong></div>
          <div class="review-block"><span>Microsoft</span><strong>{{ config.skipMicrosoft ? 'Skipped' : (config.graphTenantId || 'Not set') }}</strong></div>
          <div class="review-block"><span>Ollama</span><strong>{{ config.skipOllama ? 'Skipped' : (config.ollamaHost || 'Not set') }}</strong></div>
        </div>
        <div class="step-actions">
          <button class="btn btn-ghost" @click="goToPrevStep">Back</button>
          <button class="btn btn-primary" :disabled="saving" @click="completeSetup">{{ saving ? 'Saving…' : 'Complete Setup' }}</button>
        </div>
      </section>

      <section v-if="currentStep === 6" class="step completion-card">
        <div class="completion-mark">✓</div>
        <h2>Setup complete</h2>
        <p>Your desktop app is ready.</p>
        <button class="btn btn-primary" @click="hideWizard">Go to Dashboard</button>
      </section>
    </div>

    <div v-if="errorMessage" class="error-dialog">
      <div class="error-card">
        <h3>Error</h3>
        <p>{{ errorMessage }}</p>
        <button class="btn btn-secondary" @click="dismissError">Close</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useSetupWizard } from '../composables/useSetupWizard'
const {
  currentStep,
  totalSteps,
  config,
  saving,
  errorMessage,
  progressPercent,
  canProceedToNext,
  testingJira,
  jiraTestResult,
  testingGraph,
  graphTestResult,
  testingOllama,
  ollamaTestResult,
  availableOllamaModels,
  hydrationTick,
  microsoftSaved,
  goToNextStep,
  goToPrevStep,
  testJiraConnection,
  testGraphConnection,
  testOllamaConnection,
  completeSetup,
  dismissError,
  loadExistingConfig,
} = useSetupWizard()

onMounted(() => {
  loadExistingConfig()
})

const openMicrosoftSignIn = async () => {
  if (!config.value.graphClientId) {
    return
  }

  // The backend builds the URL so its PKCE challenge, scopes and redirect URI
  // match exactly what the callback sends to the token endpoint.
  let url: string
  try {
    const authUrl = await invoke<{ success?: boolean; url?: string; message?: string }>(
      'get_oauth_authorize_url'
    )
    if (!authUrl?.url) throw new Error(authUrl?.message || 'No sign-in URL returned.')
    url = authUrl.url
  } catch (error) {
    graphTestResult.value = {
      success: false,
      message: error instanceof Error ? error.message : 'Could not start Microsoft sign-in.',
    }
    return
  }

  void invoke('open_external_url', { url })
  graphTestResult.value = {
    success: true,
    message: 'Microsoft sign-in window opened. Waiting for authentication...',
  }

  const pollOAuthStatus = async () => {
    const pollInterval = 1000
    const maxPolls = 300

    for (let pollCount = 0; pollCount < maxPolls; pollCount++) {
      try {
        const status = await invoke<{ success: boolean; code?: string | null; timestamp?: string | null }>('get_oauth_status', { clear: false })
        if (status?.success) {
          microsoftSaved.value = true
          graphTestResult.value = {
            success: true,
            message: '✅ Microsoft authentication successful!',
          }
          await invoke('get_oauth_status', { clear: true })
          return
        }
      } catch {
        // Keep waiting quietly; the user only needs the final result.
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval))
    }

    if (!microsoftSaved.value) {
      graphTestResult.value = {
        success: false,
        message: 'Microsoft sign-in timed out. Please try again.',
      }
    }
  }

  void pollOAuthStatus()
}

const hideWizard = () => {
  window.dispatchEvent(new CustomEvent('hide-setup-wizard'))
}
</script>
