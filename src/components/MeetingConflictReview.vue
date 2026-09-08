<template>
  <section class="conflict-review">
    <button class="review-toggle" @click="toggle">
      <span>📅 Meeting choices for this day{{ conflicts.length ? ` (${conflicts.length})` : '' }}</span>
      <span class="chevron" :class="{ open }">▾</span>
    </button>

    <div v-if="open" class="review-body">
      <p v-if="loading" class="review-status">Loading…</p>
      <p v-else-if="conflicts.length === 0" class="review-status">
        No overlapping meetings found for this day.
      </p>
      <div v-else class="review-list">
        <div v-for="(conflict, index) in conflicts" :key="index" class="review-item">
          <div class="review-summary">
            <span>{{ conflict.events.map(e => e.subject).join(' / ') }}</span>
            <button class="btn-link" @click="toggleEdit(index)">
              {{ editingIndex === index ? 'Cancel' : (hasResolution(conflict) ? 'Change choice' : 'Choose') }}
            </button>
          </div>
          <p v-if="hasResolution(conflict) && editingIndex !== index" class="review-current">
            {{ describeResolution(conflict) }}
          </p>
          <MeetingConflictEditor
            v-if="editingIndex === index"
            :key="`edit-${index}`"
            :group-name="`review-${index}`"
            :events="conflict.events"
            :saving="saving"
            @resolve="resolutions => save(conflict, resolutions)"
          />
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useEntriesStore } from '../stores/entries'
import { useUiStore } from '../stores/ui'
import MeetingConflictEditor from './MeetingConflictEditor.vue'
import type { MeetingConflict, MeetingConflictEvent, MeetingConflictResolutionInput } from '../models/entries'

const props = defineProps<{ date: string }>()

const entriesStore = useEntriesStore()
const uiStore = useUiStore()

const open = ref(false)
const editingIndex = ref<number | null>(null)
const saving = ref(false)
const conflicts = ref<MeetingConflict[]>([])
const loading = ref(false)

const load = async (): Promise<void> => {
  loading.value = true
  editingIndex.value = null
  try {
    conflicts.value = await entriesStore.loadMeetingConflicts(props.date)
  } finally {
    loading.value = false
  }
}

const toggle = (): void => {
  open.value = !open.value
  if (open.value) load()
}

// Plans change day to day, so the list is reloaded whenever the visible
// date changes rather than caching a stale result from a previous day.
watch(() => props.date, () => {
  conflicts.value = []
  if (open.value) load()
})

const toggleEdit = (index: number): void => {
  editingIndex.value = editingIndex.value === index ? null : index
}

const hasResolution = (conflict: MeetingConflict): boolean =>
  conflict.events.some(event => event.resolution)

/** The time actually logged for an event: its override if one was chosen, otherwise its original slot. */
const effectiveTimes = (event: MeetingConflictEvent): { start: string; end: string } => ({
  start: event.resolution?.startTimeOverride || event.startTime,
  end: event.resolution?.endTimeOverride || event.endTime
})

const describeResolution = (conflict: MeetingConflict): string => {
  const attended = conflict.events
    .filter(event => event.resolution?.attended)
    .sort((a, b) => effectiveTimes(a).start.localeCompare(effectiveTimes(b).start))
  if (attended.length === 0) return "You said you didn't attend either."
  if (attended.length === 1) {
    const { start, end } = effectiveTimes(attended[0])
    return `You attended: ${attended[0].subject} (${start}–${end}).`
  }
  return attended
    .map(event => { const { start, end } = effectiveTimes(event); return `${event.subject} ${start}–${end}` })
    .join(', then ') + '.'
}

const save = async (_conflict: MeetingConflict, resolutions: MeetingConflictResolutionInput[]): Promise<void> => {
  saving.value = true
  try {
    const result = await entriesStore.resolveMeetingConflict(props.date, resolutions)
    if (result) {
      editingIndex.value = null
      await load()
    } else {
      uiStore.showError('Could not save your choice')
    }
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.conflict-review {
  margin: 1rem 0;
  border: 1px solid rgba(148, 163, 184, 0.15);
  border-radius: 0.75rem;
  background: rgba(51, 65, 85, 0.25);
  overflow: hidden;
}

.review-toggle {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: none;
  border: none;
  color: #e2e8f0;
  font-weight: 600;
  font-size: 0.9rem;
  padding: 0.75rem 1rem;
  cursor: pointer;
}

.chevron {
  transition: transform 0.15s ease;
  color: #94a3b8;
}

.chevron.open {
  transform: rotate(180deg);
}

.review-body {
  padding: 0 1rem 1rem;
}

.review-status {
  color: #94a3b8;
  font-size: 0.85rem;
  margin: 0;
}

.review-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.review-item {
  padding: 0.75rem;
  background: rgba(15, 23, 42, 0.4);
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 0.5rem;
}

.review-summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  color: #e2e8f0;
  font-weight: 600;
  font-size: 0.85rem;
}

.review-current {
  margin: 0.4rem 0 0;
  color: #94a3b8;
  font-size: 0.8rem;
}

.btn-link {
  background: none;
  border: none;
  color: #06b6d4;
  font-weight: 600;
  font-size: 0.8rem;
  cursor: pointer;
  padding: 0;
  white-space: nowrap;
}

.btn-link:hover {
  color: #22d3ee;
}
</style>
