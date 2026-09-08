<template>
  <div v-if="visible" class="modal-overlay" @click.self="skipAll">
    <div class="modal prompt-modal">
      <div class="modal-header">
        <h2>🎟️ Choose tickets for synced meetings</h2>
        <button class="modal-close" @click="skipAll">✕</button>
      </div>

      <p class="prompt-intro">
        These meetings don't match any of your Current Sprint keywords, so they
        have no ticket and can't be submitted to Tempo. Pick a ticket for each,
        or skip to leave it for later.
      </p>

      <div class="prompt-list">
        <div v-for="item in items" :key="item.subject" class="prompt-item" :class="{ done: item.assigned }">
          <div class="prompt-item-head">
            <span class="prompt-subject">{{ item.subject }}</span>
            <span v-if="item.assigned" class="prompt-done">✓ {{ item.assigned }}</span>
          </div>

          <template v-if="!item.assigned">
            <div class="prompt-controls">
              <select v-model="item.choice" class="prompt-select">
                <option value="">Select a ticket...</option>
                <optgroup v-if="ceremonyOptions.length" label="Sprint ceremonies">
                  <option v-for="opt in ceremonyOptions" :key="opt.ticketKey" :value="opt.ticketKey">
                    {{ opt.label }} — {{ opt.ticketKey }}
                  </option>
                </optgroup>
                <optgroup v-if="item.searchResults.length" label="Search results">
                  <option v-for="r in item.searchResults" :key="r.key" :value="r.key">
                    {{ r.key }} — {{ r.summary }}
                  </option>
                </optgroup>
              </select>

              <input
                v-model="item.searchText"
                class="prompt-search"
                placeholder="Search Jira, or type a key like TIME-449"
                @keyup.enter="searchJira(item)"
              />
              <button class="btn-mini" :disabled="item.searching || !item.searchText" @click="searchJira(item)">
                {{ item.searching ? '⏳' : '🔍' }}
              </button>
            </div>

            <div v-if="item.searchMessage" class="prompt-note">{{ item.searchMessage }}</div>

            <div class="prompt-remember">
              <label class="remember-toggle">
                <input type="checkbox" v-model="item.remember" />
                Remember for future syncs
              </label>
              <input
                v-if="item.remember"
                v-model="item.keyword"
                class="prompt-keyword"
                placeholder="keyword to match on"
              />
            </div>
            <small v-if="item.remember" class="prompt-note">
              Meetings containing “{{ item.keyword || item.subject }}” will use this ticket automatically.
            </small>

            <div class="prompt-actions">
              <button class="btn-assign" :disabled="!item.choice || item.saving" @click="assign(item)">
                {{ item.saving ? 'Saving...' : 'Assign' }}
              </button>
              <button class="btn-skip" @click="skip(item)">Skip</button>
            </div>
          </template>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-secondary" @click="skipAll">
          {{ allHandled ? 'Close' : 'Skip remaining' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { executeApi, asList } from '@/shared/utils/api'
import { asRecord, asString, asNumber } from '@/shared/utils/schema'
import { useUiStore } from '@/shared/stores/ui'

import type { UnmappedMeeting } from '@/features/entries/models/entries'
interface PromptItem {
  subject: string
  entryIds: number[]
  choice: string
  searchText: string
  searchResults: { key: string; summary: string }[]
  searchMessage: string
  searching: boolean
  saving: boolean
  remember: boolean
  keyword: string
  assigned: string
}

const props = defineProps<{ meetings: UnmappedMeeting[] }>()
const emit = defineEmits<{ (e: 'close', assignedCount: number): void }>()

const uiStore = useUiStore()
const items = ref<PromptItem[]>([])
const ceremonyOptions = ref<{ label: string; ticketKey: string }[]>([])
const assignedCount = ref(0)

const visible = computed(() => items.value.length > 0)
const allHandled = computed(() => items.value.every(i => i.assigned))

const loadCeremonies = async (): Promise<void> => {
  try {
    const result = asRecord(await executeApi('sprint_get_config', {}))
    const config = asRecord(result.config)
    ceremonyOptions.value = asList(config.mappings)
      .map(raw => asRecord(raw))
      .filter(m => asString(m.ticketKey, ''))
      .map(m => ({ label: asString(m.label, ''), ticketKey: asString(m.ticketKey, '') }))
  } catch (err) {
    console.error('Failed to load sprint mappings:', err)
  }
}

watch(() => props.meetings, meetings => {
  assignedCount.value = 0
  items.value = (meetings || []).map(m => ({
    subject: m.subject,
    entryIds: m.entryIds || [],
    choice: '',
    searchText: m.subject,
    searchResults: [],
    searchMessage: '',
    searching: false,
    saving: false,
    remember: true,
    keyword: m.subject,
    assigned: ''
  }))
  if (items.value.length > 0) void loadCeremonies()
}, { immediate: true })

const searchJira = async (item: PromptItem): Promise<void> => {
  item.searching = true
  item.searchMessage = ''
  try {
    const result = asRecord(await executeApi('jira_find_ticket', { query: item.searchText, limit: 8 }))
    const matches = asList(result.matches).map(raw => {
      const row = asRecord(raw)
      return { key: asString(row.key, ''), summary: asString(row.summary, '') }
    }).filter(r => r.key)
    item.searchResults = matches
    if (matches.length > 0) {
      item.choice = matches[0].key
      item.searchMessage = `${matches.length} match(es) found`
    } else {
      item.searchMessage = asString(result.message, 'No matching tickets found')
    }
  } catch (err) {
    item.searchMessage = err instanceof Error ? err.message : 'Search failed'
  } finally {
    item.searching = false
  }
}

const assign = async (item: PromptItem): Promise<void> => {
  item.saving = true
  try {
    const result = asRecord(await executeApi('sprint_assign_meeting_ticket', {
      subject: item.subject,
      ticketKey: item.choice,
      entryIds: item.entryIds,
      remember: item.remember,
      keyword: item.remember ? (item.keyword || item.subject) : ''
    }))
    if (asNumber(result.updated) > 0 || asString(result.ticketKey, '')) {
      item.assigned = asString(result.ticketKey, item.choice)
      assignedCount.value += 1
      if (allHandled.value) close()
    } else {
      uiStore.showError(asString(result.message, 'Could not assign ticket'))
    }
  } catch (err) {
    uiStore.reportError(err, 'Failed to assign ticket')
  } finally {
    item.saving = false
  }
}

const skip = (item: PromptItem): void => {
  items.value = items.value.filter(i => i !== item)
  if (items.value.length === 0) close()
}

const close = (): void => {
  const count = assignedCount.value
  items.value = []
  emit('close', count)
}

const skipAll = (): void => close()
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: linear-gradient(135deg, #0f172a, #1a1f3a);
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 1rem;
  padding: 2rem;
  width: 90%;
  max-height: 90vh;
  overflow-y: auto;
}

.prompt-modal {
  max-width: 720px;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
}

.modal-header h2 {
  font-size: 1.25rem;
  font-weight: 700;
}

.modal-close {
  background: none;
  border: none;
  color: #cbd5e1;
  font-size: 1.4rem;
  cursor: pointer;
}

.modal-close:hover {
  color: #e2e8f0;
}

.prompt-intro {
  font-size: 0.875rem;
  color: #94a3b8;
  line-height: 1.5;
  margin: 0 0 1.25rem;
}

.prompt-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.prompt-item {
  padding: 1rem;
  background: rgba(51, 65, 85, 0.35);
  border: 1px solid rgba(148, 163, 184, 0.15);
  border-radius: 0.75rem;
}

.prompt-item.done {
  border-color: rgba(34, 197, 94, 0.4);
  background: rgba(34, 197, 94, 0.08);
}

.prompt-item-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.prompt-subject {
  font-weight: 600;
  color: #e2e8f0;
}

.prompt-done {
  color: #4ade80;
  font-family: 'Cascadia Code', Consolas, monospace;
  font-size: 0.875rem;
  white-space: nowrap;
}

.prompt-controls {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.prompt-select,
.prompt-search,
.prompt-keyword {
  padding: 0.5rem 0.65rem;
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.4rem;
  color: #e2e8f0;
  font-size: 0.875rem;
  font-family: inherit;
}

.prompt-select {
  flex: 1.1;
  min-width: 0;
}

.prompt-search {
  flex: 1;
  min-width: 0;
}

.prompt-select:focus,
.prompt-search:focus,
.prompt-keyword:focus {
  outline: none;
  border-color: #06b6d4;
}

.btn-mini {
  padding: 0.5rem 0.7rem;
  background: rgba(6, 182, 212, 0.15);
  border: 1px solid rgba(6, 182, 212, 0.4);
  border-radius: 0.4rem;
  color: #67e8f9;
  cursor: pointer;
  font-size: 0.9rem;
}

.btn-mini:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.prompt-note {
  display: block;
  font-size: 0.8rem;
  color: #94a3b8;
  margin-top: 0.5rem;
}

.prompt-remember {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 0.75rem;
}

.remember-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: #cbd5e1;
  white-space: nowrap;
  cursor: pointer;
}

.remember-toggle input {
  width: 16px;
  height: 16px;
  accent-color: #06b6d4;
}

.prompt-keyword {
  flex: 1;
  min-width: 0;
}

.prompt-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 1rem;
}

.btn-assign {
  padding: 0.5rem 1.25rem;
  background: linear-gradient(135deg, #06b6d4, #0891b2);
  border: none;
  border-radius: 0.4rem;
  color: #0f172a;
  font-weight: 600;
  font-size: 0.875rem;
  cursor: pointer;
}

.btn-assign:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-skip {
  padding: 0.5rem 1.25rem;
  background: rgba(51, 65, 85, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.4rem;
  color: #cbd5e1;
  font-size: 0.875rem;
  cursor: pointer;
}

.btn-skip:hover {
  background: rgba(51, 65, 85, 0.9);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid rgba(148, 163, 184, 0.1);
}

.btn-secondary {
  padding: 0.6rem 1.4rem;
  background: rgba(51, 65, 85, 0.5);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.5rem;
  color: #cbd5e1;
  font-weight: 600;
  cursor: pointer;
}

.btn-secondary:hover {
  background: rgba(51, 65, 85, 0.8);
}
</style>
