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
import { useEntriesStore } from '@/shared/stores/entries'

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
.modal {
  max-height: 90vh;
  overflow-y: auto;
}

.prompt-modal {
  max-width: 480px;
}

.modal-header {
  margin-bottom: 1rem;
}

.modal-header h2 {
  font-size: 1.25rem;
  font-weight: 700;
}

.modal-close {
  font-size: 1.4rem;
  transition: none;
}

.modal-close:hover {
  color: var(--color-text);
}

.prompt-intro {
  font-size: 0.875rem;
  color: var(--color-text-subtle);
  line-height: 1.5;
  margin: 0 0 1rem;
}

.conflict-list {
  margin: 0 0 1.25rem;
  padding-left: 1.25rem;
  font-size: 0.85rem;
  color: var(--color-text-muted);
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
  color: var(--color-text-subtle);
}

.time-input {
  padding: 0.5rem 0.65rem;
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid var(--color-border-strong);
  border-radius: 0.4rem;
  color: var(--color-text);
  font-size: 0.875rem;
  font-family: inherit;
}

.time-input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.prompt-note {
  display: block;
  font-size: 0.8rem;
  color: var(--color-text-subtle);
  margin-top: 0.75rem;
}

.prompt-note.error {
  color: #f87171;
}

.modal-footer {
  gap: 0.75rem;
  margin-top: 1.5rem;
}

.btn-assign {
  padding: 0.5rem 1.25rem;
  background: linear-gradient(135deg, var(--color-accent), var(--color-accent-strong));
  border: none;
  border-radius: 0.4rem;
  color: var(--color-on-accent);
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
  transition: none;
}

.btn-secondary:hover {
  background: var(--color-control-hover);
}
</style>
