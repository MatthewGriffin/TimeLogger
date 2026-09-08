<template>
  <div class="settings-section">
    <h2>Microsoft Integration Settings</h2>
    <div class="settings-form">
      <div class="form-group checkbox">
        <input v-model="props.formData.enabled" type="checkbox" id="microsoft-enabled" />
        <label for="microsoft-enabled">Enable Microsoft Graph API (OneNote sync)</label>
      </div>

      <div class="form-group">
        <label>Client ID *</label>
        <input
          v-model="props.formData.clientId"
          type="text"
          placeholder="Azure app client ID"
          :disabled="!props.formData.enabled"
        />
      </div>

      <div class="form-group">
        <label>Tenant ID *</label>
        <input
          v-model="props.formData.tenantId"
          type="text"
          placeholder="Azure tenant ID or 'common'"
          :disabled="!props.formData.enabled"
        />
        <p class="field-hint">
          Use your organisation's tenant ID for a work account, or
          <code>consumers</code> for a personal Microsoft account. Signing in to an org
          tenant with a personal address creates a guest with no mailbox or OneNote.
        </p>
      </div>

      <div class="form-group">
        <label>Client Secret</label>
        <input
          v-model="props.formData.clientSecret"
          type="password"
          placeholder="Leave blank for a public client registration"
          :disabled="!props.formData.enabled"
        />
        <p class="field-hint">
          Only needed for confidential clients. Leave blank if your Azure app is registered
          as a public client (mobile &amp; desktop) — sign-in then uses PKCE.
        </p>
      </div>

      <div class="account-connection">
        <div class="account-status">
          <span class="status-dot" :class="{ connected: props.microsoftConnected }"></span>
          <span>
            {{ props.microsoftConnected ? 'Microsoft account connected' : 'Microsoft account not connected' }}
          </span>
        </div>
        <p v-if="props.microsoftConnected && props.microsoftAccount" class="account-hint">
          Signed in as <strong>{{ props.microsoftAccount }}</strong>.
        </p>
        <div v-if="props.graphBlockers.length > 0" class="account-warning">
          <strong>Signed in, but this account cannot be used:</strong>
          <ul>
            <li v-for="blocker in props.graphBlockers" :key="blocker.name">
              <strong>{{ blocker.name }}:</strong> {{ blocker.reason }}
            </li>
          </ul>
          <p>
            Sign out and sign in with the work account that holds the notebook. If that account
            is in a different Microsoft tenant to the app registration above, set Tenant ID to
            <code>organizations</code> and make the registration multi-tenant.
          </p>
        </div>
        <p class="account-hint">
          Used for OneNote note backups only. Calendar sync reads the local Outlook app and
          does not need this.
        </p>
        <button
          type="button"
          class="btn-secondary"
          :disabled="!props.canConnectMicrosoft || props.isConnectingMicrosoft"
          @click="$emit('connect-microsoft')"
        >
          {{ props.isConnectingMicrosoft ? 'Waiting for sign-in…' : (props.microsoftConnected ? 'Reconnect Microsoft Account' : 'Sign in with Microsoft') }}
        </button>
        <p v-if="props.microsoftConnectMessage" class="account-message" :class="{ error: props.microsoftConnectFailed }">
          {{ props.microsoftConnectMessage }}
        </p>
      </div>

      <div class="info-box">
        <span class="info-icon">ℹ️</span>
        <div>
          <p><strong>OneNote Sync via Graph API:</strong></p>
          <ol>
            <li>Register your app in <a href="https://portal.azure.com" target="_blank">Azure Portal</a></li>
            <li>Copy your Client ID and Tenant ID (a Client Secret is only needed for confidential clients)</li>
            <li>Enable required permissions: Notes.ReadWrite.All</li>
            <li>Add redirect URI: <code>http://localhost:3001/api/setup/oauth-callback</code></li>
            <li>Save the settings, then click <strong>Sign in with Microsoft</strong></li>
          </ol>
          <p style="margin-top: 12px; font-size: 0.9em; color: #666;">
            📧 <strong>Email:</strong> Outlook email access is provided by a local COM extension and does not require Graph API configuration.
          </p>
        </div>
      </div>

      <div class="form-hint">
        💡 Graph API enables OneNote sync. Email is accessed locally via COM extension.
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { GraphBlocker, MicrosoftSettingsForm } from '@/features/settings/models/settings'

const props = defineProps<{
  formData: MicrosoftSettingsForm
  microsoftConnected: boolean
  microsoftAccount: string
  graphBlockers: GraphBlocker[]
  canConnectMicrosoft: boolean
  isConnectingMicrosoft: boolean
  microsoftConnectMessage: string
  microsoftConnectFailed: boolean
}>()

defineEmits<{
  'connect-microsoft': []
}>()
</script>
