<template>
  <div class="conflict-editor">
    <div v-for="event in events" :key="event.id" class="conflict-option">
      <label class="conflict-label">
        <input type="radio" :name="groupName" :value="event.id" v-model="mode" />
        <span class="conflict-subject">{{ event.subject }}</span>
        <span class="conflict-time">{{ event.startTime }}–{{ event.endTime }}</span>
      </label>
    </div>

    <div v-if="canSplit" class="conflict-option">
      <label class="conflict-label">
        <input type="radio" :name="groupName" value="split" v-model="mode" />
        <span class="conflict-subject">Left {{ first.subject }} early to join {{ second.subject }}</span>
      </label>
      <div v-if="mode === 'split'" class="split-fields">
        <span>Switched over at</span>
        <input type="time" v-model="cutover" class="split-time" />
      </div>
      <p v-if="mode === 'split' && !splitError" class="split-preview">
        {{ first.subject }} {{ first.startTime }}–{{ cutover }}, then {{ second.subject }} {{ cutover }}–{{ second.endTime }}
      </p>
    </div>

    <label class="conflict-label">
      <input type="radio" :name="groupName" value="none" v-model="mode" />
      <span class="conflict-subject">I didn't attend either of these</span>
    </label>

    <p v-if="splitError" class="split-error">{{ splitError }}</p>

    <div class="prompt-actions">
      <button class="btn-assign" :disabled="saving || !!splitError" @click="submit">
        {{ saving ? 'Saving...' : 'Save' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { MeetingConflictEvent, MeetingConflictResolutionInput } from '../models/entries'

const props = defineProps<{
  groupName: string
  events: MeetingConflictEvent[]
  saving: boolean
}>()

const emit = defineEmits<{
  resolve: [resolutions: MeetingConflictResolutionInput[]]
}>()

// Splitting a shared time only makes sense for exactly two events; a
// three-way overlap still needs a plain pick-one choice.
const canSplit = computed(() => props.events.length === 2)
const sorted = computed(() => [...props.events].sort((a, b) => a.startTime.localeCompare(b.startTime)))
const first = computed(() => sorted.value[0])
const second = computed(() => sorted.value[1])

const initialMode = (): string => {
  const attended = props.events.filter(e => e.resolution?.attended)
  if (attended.length === 0) return props.events.some(e => e.resolution) ? 'none' : ''
  if (attended.length === 1 && !attended[0].resolution?.startTimeOverride && !attended[0].resolution?.endTimeOverride) {
    return attended[0].id
  }
  return canSplit.value ? 'split' : attended[0].id
}

const initialCutover = (): string => {
  const withOverride = props.events.find(e => e.resolution?.startTimeOverride || e.resolution?.endTimeOverride)
  return withOverride?.resolution?.startTimeOverride || withOverride?.resolution?.endTimeOverride || second.value?.startTime || ''
}

const mode = ref<string>(initialMode())
const cutover = ref<string>(initialCutover())

const splitError = computed(() => {
  if (mode.value !== 'split') return ''
  if (!cutover.value) return 'Choose a switch-over time'
  // The only valid switch-over point is inside the actual overlap: after the
  // second meeting has started (or it isn't "joining" anything) and before
  // the first meeting was due to end (or nothing was left to leave early from).
  if (cutover.value < second.value.startTime || cutover.value > first.value.endTime) {
    return `Switch-over time must be between ${second.value.startTime} and ${first.value.endTime}`
  }
  return ''
})

const submit = (): void => {
  if (splitError.value) return
  let resolutions: MeetingConflictResolutionInput[]
  if (mode.value === 'none' || mode.value === '') {
    resolutions = props.events.map(event => ({ eventId: event.id, attended: false }))
  } else if (mode.value === 'split') {
    resolutions = [
      { eventId: first.value.id, attended: true, endTimeOverride: cutover.value },
      { eventId: second.value.id, attended: true, startTimeOverride: cutover.value }
    ]
  } else {
    resolutions = props.events.map(event => ({ eventId: event.id, attended: event.id === mode.value }))
  }
  emit('resolve', resolutions)
}
</script>

<style scoped>
.conflict-editor {
  display: flex;
  flex-direction: column;
}

.conflict-option {
  margin-bottom: 0.5rem;
}

.conflict-label {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  cursor: pointer;
  padding: 0.35rem 0;
}

.conflict-label input[type='radio'] {
  width: 16px;
  height: 16px;
  accent-color: #06b6d4;
}

.conflict-subject {
  color: #e2e8f0;
  font-weight: 600;
}

.conflict-time {
  color: #94a3b8;
  font-family: 'Cascadia Code', Consolas, monospace;
  font-size: 0.8rem;
}

.split-fields {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin: 0.4rem 0 0.4rem 1.7rem;
  color: #cbd5e1;
  font-size: 0.85rem;
}

.split-time {
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.25);
  border-radius: 0.35rem;
  color: #e2e8f0;
  padding: 0.25rem 0.5rem;
}

.split-error {
  color: #f87171;
  font-size: 0.8rem;
  margin: 0.25rem 0 0 1.7rem;
}

.split-preview {
  color: #4ade80;
  font-size: 0.8rem;
  margin: 0.4rem 0 0 1.7rem;
  font-family: 'Cascadia Code', Consolas, monospace;
}

.prompt-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 0.75rem;
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
</style>
