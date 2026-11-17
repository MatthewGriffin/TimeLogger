<template>
  <div class="ticket-notes">
    <ul v-if="notes.length" class="note-list">
      <li v-for="note in notes" :key="note.id"><span class="note-date">{{ note.date }}</span> {{ note.note }}</li>
    </ul>
    <p v-else-if="!loading" class="muted">No notes yet.</p>
    <form class="note-form" @submit.prevent="submit">
      <label class="visually-hidden" :for="`note-${ticketKey}`">Note for {{ ticketKey }}</label>
      <textarea :id="`note-${ticketKey}`" v-model="draft" rows="2" placeholder="Add a note about this ticket" />
      <div class="note-actions">
        <button type="submit" :disabled="!draft.trim() || saving">Add note</button>
        <router-link to="/notes">Open Notes</router-link>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import type { PlanNote } from '../composables/useSprintPlan'

const props = defineProps<{
  ticketKey: string
  /** Bumps when a note is added so the list reloads. */
  noteCount: number
  load: (key: string) => Promise<PlanNote[]>
  add: (key: string, note: string) => Promise<boolean>
}>()

const notes = ref<PlanNote[]>([])
const draft = ref('')
const loading = ref(true)
const saving = ref(false)

const reload = async () => {
  try { notes.value = await props.load(props.ticketKey) } catch { notes.value = [] } finally { loading.value = false }
}

const submit = async () => {
  const text = draft.value.trim()
  if (!text) return
  saving.value = true
  try {
    if (await props.add(props.ticketKey, text)) draft.value = ''
  } finally { saving.value = false }
}

onMounted(reload)
watch(() => props.noteCount, reload)
</script>

<style scoped>
.ticket-notes { padding: .75rem 1rem 1rem; border-top: 1px solid var(--color-border); display: flex; flex-direction: column; gap: .6rem; }
.note-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: .4rem; }
.note-list li { white-space: pre-line; overflow-wrap: anywhere; }
.note-date { color: var(--color-text-muted); font-size: .8rem; margin-right: .4rem; }
.muted { margin: 0; color: var(--color-text-muted); }
.note-form textarea { width: 100%; box-sizing: border-box; padding: .55rem .7rem; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text); font: inherit; resize: vertical; }
.note-actions { display: flex; align-items: center; gap: 1rem; margin-top: .5rem; }
.note-actions button { padding: .45rem .9rem; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-control); color: var(--color-text); cursor: pointer; }
.note-actions button:disabled { opacity: .55; cursor: default; }
.note-actions a { color: var(--color-accent); font-size: .9rem; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
