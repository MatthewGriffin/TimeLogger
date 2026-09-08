<template>
  <section class="scrum-day">
    <header class="day-header">
      <h3>{{ label }}</h3>
      <span class="day-date">{{ formattedDate }}</span>
    </header>

    <div v-if="day.entries.length === 0" class="day-empty">
      Nothing logged.
    </div>

    <div v-else class="day-entries">
      <ScrumEntryRow v-for="entry in day.entries" :key="entry.id" :entry="entry" />
      <div class="day-total">Total {{ formattedTotal }}</div>
    </div>

    <div v-if="day.notes.length > 0" class="day-notes">
      <h4>Notes</h4>
      <ul>
        <li v-for="note in day.notes" :key="note.id">
          <span v-if="note.ticketId" class="note-ticket">{{ note.ticketId }}</span>
          {{ note.title || note.note }}
        </li>
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import ScrumEntryRow from '@/features/scrum/components/ScrumEntryRow.vue'
import type { ScrumDay } from '@/features/scrum/models/scrum'

const props = defineProps<{ day: ScrumDay; label: string }>()

const formattedDate = computed(() => {
  const parsed = new Date(`${props.day.date}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return props.day.date
  return parsed.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
})

const formattedTotal = computed(() => {
  const hours = Math.floor(props.day.totalMinutes / 60)
  const minutes = props.day.totalMinutes % 60
  if (hours && minutes) return `${hours}h ${minutes}m`
  if (hours) return `${hours}h`
  return `${minutes}m`
})
</script>

<style scoped>
.scrum-day {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 0.75rem;
  padding: 1.25rem;
}

.day-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.day-header h3 {
  margin: 0;
  font-size: 1rem;
}

.day-date {
  color: var(--color-text-muted);
  font-size: 0.85rem;
}

.day-empty {
  color: var(--color-text-muted);
  font-style: italic;
  padding: 0.5rem 0;
}

.day-total {
  padding-top: 0.5rem;
  text-align: right;
  font-size: 0.85rem;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.day-notes {
  margin-top: 1rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--color-border);
}

.day-notes h4 {
  margin: 0 0 0.5rem;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
}

.day-notes ul {
  margin: 0;
  padding-left: 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.day-notes li {
  font-size: 0.9rem;
}

.note-ticket {
  font-family: var(--font-mono, monospace);
  font-size: 0.78rem;
  color: var(--color-primary);
  margin-right: 0.35rem;
}
</style>
