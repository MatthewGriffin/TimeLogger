<template>
  <div class="settings-section">
    <h2>Jira & Tempo Settings</h2>
    <div class="settings-form">
      <div class="form-group">
        <label>Base URL *</label>
        <input
          v-model="props.formData.baseUrl"
          type="url"
          placeholder="https://your-domain.atlassian.net"
        />
      </div>

      <div class="form-group">
        <label>Email *</label>
        <input
          v-model="props.formData.email"
          type="email"
          placeholder="your.email@example.com"
        />
      </div>

      <div class="form-group">
        <label>Jira API Key *</label>
        <input
          v-model="props.formData.apiToken"
          type="password"
          placeholder="Paste your API token"
        />
        <small>Get from Jira Settings → Personal Settings → API tokens or ask your Jira admin</small>
      </div>

      <div class="form-group">
        <label>Tempo API Token *</label>
        <input
          v-model="props.formData.tempoToken"
          type="password"
          placeholder="Paste your Tempo API token"
        />
        <small>Required for worklog uploads. Get from Tempo Settings → Data Access → API integration (or ask your Jira admin for the API token)</small>
      </div>

      <div class="form-group">
        <label>Default Issue Mapping</label>
        <input
          v-model="props.formData.defaultIssueMapping"
          type="text"
          placeholder="e.g., PROJ-1234"
        />
      </div>

      <div class="form-hint">
        💡 Get your API token from
        <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank">
          Atlassian account settings
        </a>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { JiraTempoSettingsForm } from '../../models/settings'

const props = defineProps<{
  formData: JiraTempoSettingsForm
}>()
</script>
