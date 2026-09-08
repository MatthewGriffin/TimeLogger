<template>
  <div v-if="conflict" class="modal-overlay" @click.self="dismiss">
    <div class="modal prompt-modal">
      <div class="modal-header">
        <h2>🥪 Lunch time conflicts with an entry</h2>
        <button class="modal-close" @click="dismiss">✕</button>
      </div>

      <p class="prompt-intro">
        {{ conflict?.message }}. Pick a different time for
        <strong>{{ conflict?.name }}</strong> on {{ conflict?.date }}, or skip adding
        it for today.
      </p>

      <ul class="conflict-list">
        <li v-for="entry in conflict?.conflictingEntries" :key="entry.id">
          {{ entry.name }} ({{ entry.startTime }}–{{ entry.endTime }})
        </li>
      </ul>

      <div class="time-controls">
        <label>
          Start
          <input v-model="startTime" type="time" class="time-input" />
        </label>
        <label>
          End
          <input v-model="endTime" type="time" class="time-input" />
        </label>
      </div>

      <div v-if="errorMessage" class="prompt-note error">{{ errorMessage }}</div>

      <div class="modal-footer">
        <button class="btn-secondary" @click="dismiss">Skip for today</button>
        <button class="btn-assign" :disabled="saving || !startTime || !endTime" @click="save">
          {{ saving ? 'Saving...' : 'Save lunch time' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useEntriesStore } from '../stores/entries'

const entriesStore = useEntriesStore()
const conflict = computed(() => entriesStore.pendingLunchConflict)

const startTime = ref('')
const endTime = ref('')
const saving = ref(false)
const errorMessage = ref('')

watch(conflict, value => {
  errorMessage.value = ''
  startTime.value = value?.startTime || ''
  endTime.value = value?.endTime || ''
}, { immediate: true })

const save = async (): Promise<void> => {
  saving.value = true
  errorMessage.value = ''
  try {
    const result = await entriesStore.resolveLunchConflict(startTime.value, endTime.value)
    if (result && (result as { conflict?: boolean }).conflict) {
      errorMessage.value = 'That time still overlaps an entry. Try another.'
    }
  } finally {
    saving.value = false
  }
}

const dismiss = (): void => {
  entriesStore.dismissLunchConflict()
}
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
  max-width: 480px;
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
  margin: 0 0 1rem;
}

.conflict-list {
  margin: 0 0 1.25rem;
  padding-left: 1.25rem;
  font-size: 0.85rem;
  color: #cbd5e1;
}

.time-controls {
  display: flex;
  gap: 1rem;
}

.time-controls label {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.8rem;
  color: #94a3b8;
}

.time-input {
  padding: 0.5rem 0.65rem;
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.4rem;
  color: #e2e8f0;
  font-size: 0.875rem;
  font-family: inherit;
}

.time-input:focus {
  outline: none;
  border-color: #06b6d4;
}

.prompt-note {
  display: block;
  font-size: 0.8rem;
  color: #94a3b8;
  margin-top: 0.75rem;
}

.prompt-note.error {
  color: #f87171;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid rgba(148, 163, 184, 0.1);
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
