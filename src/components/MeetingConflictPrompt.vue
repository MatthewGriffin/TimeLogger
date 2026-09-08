<template>
  <div v-if="visible" class="modal-overlay" @click.self="skipAll">
    <div class="modal prompt-modal">
      <div class="modal-header">
        <h2>📅 Overlapping meetings — which did you attend?</h2>
        <button class="modal-close" @click="skipAll">✕</button>
      </div>

      <p class="prompt-intro">
        These meetings overlap in your calendar, so only one can be logged as
        time worked. Pick the one you actually attended for each group.
      </p>

      <div class="prompt-list">
        <div v-for="(group, index) in groups" :key="index" class="prompt-item" :class="{ done: group.resolved }">
          <MeetingConflictEditor
            v-if="!group.resolved"
            :group-name="`conflict-${index}`"
            :events="group.events"
            :saving="group.saving"
            @resolve="resolutions => resolveGroup(group, resolutions)"
          />
          <div v-else class="prompt-done">✓ Resolved</div>
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
import { useEntriesStore } from '../stores/entries'
import { useUiStore } from '../stores/ui'
import MeetingConflictEditor from './MeetingConflictEditor.vue'
import type { MeetingConflict, MeetingConflictEvent, MeetingConflictResolutionInput } from '../models/entries'

interface ConflictGroup {
  date: string
  events: MeetingConflictEvent[]
  saving: boolean
  resolved: boolean
}

const entriesStore = useEntriesStore()
const uiStore = useUiStore()

const groups = ref<ConflictGroup[]>([])

const visible = computed(() => groups.value.length > 0)
const allHandled = computed(() => groups.value.every(g => g.resolved))

watch(() => entriesStore.pendingMeetingConflicts, (conflicts: MeetingConflict[]) => {
  groups.value = (conflicts || []).map(conflict => ({
    date: conflict.date,
    events: conflict.events,
    saving: false,
    resolved: false
  }))
}, { immediate: true, deep: true })

const resolveGroup = async (group: ConflictGroup, resolutions: MeetingConflictResolutionInput[]): Promise<void> => {
  group.saving = true
  try {
    const result = await entriesStore.resolveMeetingConflict(group.date, resolutions)
    if (result) {
      group.resolved = true
      if (allHandled.value) close()
    } else {
      uiStore.showError('Could not save your choice')
    }
  } finally {
    group.saving = false
  }
}

const close = (): void => {
  groups.value = []
}

const skipAll = (): void => {
  // Leaving the conflict unresolved in the store means it will be offered
  // again on the next sync, rather than silently dropped.
  close()
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
  max-width: 620px;
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

.prompt-done {
  color: #4ade80;
  font-weight: 600;
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
