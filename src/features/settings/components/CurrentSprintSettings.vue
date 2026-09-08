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

<style scoped>
/* Current Sprint */
.section-intro {
  font-size: 0.875rem;
  color: var(--color-text-subtle);
  line-height: 1.5;
  margin: 0 0 1rem;
}

.btn-lookup,
.btn-test {
  padding: 0.75rem 1.25rem;
  background: rgba(6, 182, 212, 0.15);
  border: 1px solid rgba(6, 182, 212, 0.4);
  border-radius: 0.5rem;
  color: #67e8f9;
  font-size: 0.9rem;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s ease;
  align-self: flex-start;
}

.btn-lookup:hover:not(:disabled),
.btn-test:hover:not(:disabled) {
  background: rgba(6, 182, 212, 0.25);
}

.btn-lookup:disabled,
.btn-test:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.lookup-msg.ok {
  color: #4ade80;
}

.mapping-table {
  border: 1px solid rgba(148, 163, 184, 0.15);
  border-radius: 0.5rem;
  overflow: hidden;
}

.mapping-header,
.mapping-row {
  display: grid;
  grid-template-columns: 12rem 9rem 1fr;
  gap: 0.75rem;
  align-items: center;
  padding: 0.6rem 0.85rem;
}

.mapping-header {
  background: var(--color-control);
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-subtle);
}

.mapping-row + .mapping-row {
  border-top: 1px solid rgba(148, 163, 184, 0.08);
}

.mapping-label {
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--color-text-muted);
}

.mapping-table input {
  width: 100%;
  padding: 0.45rem 0.6rem;
  background: var(--color-control);
  border: 1px solid var(--color-border-strong);
  border-radius: 0.35rem;
  color: var(--color-text);
  font-size: 0.875rem;
  font-family: inherit;
}

.mapping-table input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.mapping-ticket {
  font-family: 'Cascadia Code', Consolas, monospace;
}

.mapping-ticket.unset {
  border-color: rgba(248, 113, 113, 0.5);
}

.test-result {
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  font-size: 0.9rem;
}

.test-result.ok {
  background: rgba(34, 197, 94, 0.12);
  border: 1px solid rgba(34, 197, 94, 0.3);
  color: #86efac;
}
</style>
