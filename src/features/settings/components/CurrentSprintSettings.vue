<template>
  <div class="settings-section">
    <h2>Current Sprint</h2>
    <p class="section-intro">
      Recurring meetings are booked in Tempo against per-PI placeholder tickets.
      These keys are reissued every Programme Increment, so set the PI number and
      load the current tickets from Jira.
    </p>

    <div class="settings-form">
      <div class="form-row">
        <div class="form-group">
          <label>Current PI Number *</label>
          <input v-model="props.formData.piNumber" type="text" placeholder="e.g. 43" />
          <small>Used to find tickets named PI&lt;number&gt;-&lt;Type&gt;</small>
        </div>

        <div class="form-group">
          <label>Jira Project</label>
          <input v-model="props.formData.projectKey" type="text" placeholder="TIME" />
          <small>Project holding the meeting placeholders</small>
        </div>

        <div class="form-group">
          <label>Team</label>
          <input v-model="props.formData.teamLabel" type="text" placeholder="e.g. Discovery" />
          <small>Optional filter when several teams share a PI</small>
        </div>
      </div>

      <div class="form-group">
        <button class="btn-lookup" @click="$emit('lookup-pi-tickets')" :disabled="props.lookupBusy || !props.formData.piNumber">
          {{ props.lookupBusy ? '⏳ Searching Jira...' : '🔍 Load Tickets from Jira' }}
        </button>
        <small v-if="props.lookupMessage" :class="['lookup-msg', props.lookupOk ? 'ok' : 'bad']">
          {{ props.lookupMessage }}
        </small>
      </div>

      <h3>Meeting Ticket Mappings</h3>
      <p class="section-intro">
        A synced meeting is matched against these keywords to pick its ticket.
        Meetings that match nothing are still logged, but cannot be submitted to Tempo.
      </p>

      <div class="mapping-table">
        <div class="mapping-header">
          <div>Meeting Type</div>
          <div>Ticket</div>
          <div>Match Keywords (comma separated)</div>
        </div>
        <div v-for="mapping in props.formData.mappings" :key="mapping.id" class="mapping-row">
          <div class="mapping-label">{{ mapping.label }}</div>
          <div>
            <input
              v-model="mapping.ticketKey"
              type="text"
              class="mapping-ticket"
              :class="{ unset: !mapping.ticketKey }"
              placeholder="TIME-000"
            />
          </div>
          <div>
            <input v-model="mapping.aliasText" type="text" class="mapping-aliases" placeholder="keywords" />
          </div>
        </div>
      </div>

      <div class="form-group">
        <label>Fallback Ticket for Unmatched Meetings</label>
        <input v-model="props.formData.defaultMeetingTicket" type="text" placeholder="Optional, e.g. TIME-449" />
        <small>Used when a meeting matches none of the keywords above. Leave blank to require a manual ticket.</small>
      </div>

      <h3>Test a Meeting Name</h3>
      <div class="form-row">
        <div class="form-group grow">
          <input
            :value="props.testSubject"
            type="text"
            placeholder="Paste a meeting name to see which ticket it would use"
            @input="updateTestSubject"
            @keyup.enter="$emit('test-meeting-match')"
          />
        </div>
        <div class="form-group">
          <button class="btn-test" @click="$emit('test-meeting-match')" :disabled="!props.testSubject">Test</button>
        </div>
      </div>
      <div v-if="props.testResult" :class="['test-result', props.testResult.matched ? 'ok' : 'bad']">
        {{ props.testResult.text }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CurrentSprintSettingsForm, SprintTestResult } from '@/features/settings/models/settings'

const props = defineProps<{
  formData: CurrentSprintSettingsForm
  lookupBusy: boolean
  lookupMessage: string
  lookupOk: boolean
  testSubject: string
  testResult: SprintTestResult | null
}>()

const emit = defineEmits<{
  'lookup-pi-tickets': []
  'test-meeting-match': []
  'update:test-subject': [value: string]
}>()

const updateTestSubject = (event: Event) => {
  const target = event.target as HTMLInputElement | null
  emit('update:test-subject', target?.value ?? '')
}

</script>
