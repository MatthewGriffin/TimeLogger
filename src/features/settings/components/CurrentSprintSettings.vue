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
        <button type="button" class="btn-lookup" @click="$emit('lookup-pi-tickets')" :disabled="props.lookupBusy || !props.formData.piNumber">
          {{ props.lookupBusy ? '⏳ Searching Jira...' : '🔍 Load Tickets from Jira' }}
        </button>
        <small v-if="props.lookupMessage" :class="['lookup-msg', props.lookupOk ? 'ok' : 'bad']">
          {{ props.lookupMessage }}
        </small>
      </div>

      <h3>PI Configuration History</h3>
      <p class="section-intro">
        Changes are recorded when settings are saved. Older changes made before this history was introduced cannot be reconstructed.
      </p>
      <div v-if="props.configHistory.length" class="history-list">
        <div v-for="item in props.configHistory" :key="item.id" class="history-row">
          <strong>{{ item.previousPi ? 'PI' + item.previousPi : 'Initial configuration' }} → {{ item.nextPi ? 'PI' + item.nextPi : 'No PI' }}</strong>
          <span>{{ formatHistoryDate(item.changedAt) }}</span>
          <details>
            <summary>Compare ticket mappings before and after</summary>
            <div class="history-mapping-columns">
              <div>
                <strong>Before</strong>
                <div v-for="mapping in historyMappings(item.previousConfig)" :key="'before-' + mapping.id" class="history-mapping">
                  {{ mapping.label }}: {{ mapping.ticketKey || 'Not mapped' }}
                </div>
              </div>
              <div>
                <strong>After</strong>
                <div v-for="mapping in historyMappings(item.nextConfig)" :key="'after-' + mapping.id" class="history-mapping">
                  {{ mapping.label }}: {{ mapping.ticketKey || 'Not mapped' }}
                </div>
              </div>
            </div>
          </details>
        </div>
      </div>
      <p v-else class="history-empty">No PI changes have been recorded yet. The first saved change will appear here.</p>

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

    </div>
  </div>
</template>

<script setup lang="ts">
import { asArray, asRecord, asString } from '@/shared/utils/schema'
import type { CurrentSprintSettingsForm } from '@/features/settings/models/settings'

const props = defineProps<{
  formData: CurrentSprintSettingsForm
  lookupBusy: boolean
  lookupMessage: string
  lookupOk: boolean
  configHistory: Array<{
    id: number
    changedAt: string
    previousPi: string | null
    nextPi: string | null
    previousConfig: Record<string, unknown>
    nextConfig: Record<string, unknown>
  }>
}>()

const formatHistoryDate = (value: string) => {
  const date = new Date(value.replace(' ', 'T') + (value.endsWith('Z') ? '' : 'Z'))
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}
const historyMappings = (config: Record<string, unknown>) =>
  asArray(config.mappings).map(raw => {
    const mapping = asRecord(raw)
    return { id: asString(mapping.id, ''), label: asString(mapping.label, ''), ticketKey: asString(mapping.ticketKey, '') }
  })

defineEmits<{
  'lookup-pi-tickets': []
}>()
</script>

<style scoped>
.history-list { display: grid; gap: 0.65rem; margin-bottom: 1.5rem; }
.history-row { display: grid; gap: 0.35rem; padding: 0.75rem; border: 1px solid var(--color-border); border-radius: 0.5rem; }
.history-row > span, .history-empty { color: var(--color-text-subtle); font-size: 0.85rem; }
.history-mapping { padding: 0.2rem 0; font-size: 0.85rem; }
.history-mapping-columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-top: 0.5rem; }
.history-row summary { cursor: pointer; font-size: 0.85rem; }

/* Current Sprint */
.section-intro {
  font-size: 0.875rem;
  color: var(--color-text-subtle);
  line-height: 1.5;
  margin: 0 0 1rem;
}

.btn-lookup {
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

.btn-lookup:hover:not(:disabled) {
  background: rgba(6, 182, 212, 0.25);
}

.btn-lookup:disabled {
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

</style>
