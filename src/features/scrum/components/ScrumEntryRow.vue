<template>
  <div class="scrum-entry">
    <div class="entry-main">
      <span v-if="entry.ticketId" class="entry-ticket">{{ entry.ticketId }}</span>
      <span class="entry-name">{{ entry.name }}</span>
    </div>
    <span class="entry-duration">{{ formattedDuration }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ScrumEntry } from '@/features/scrum/models/scrum'

const props = defineProps<{ entry: ScrumEntry }>()

const formattedDuration = computed(() => {
  const total = props.entry.durationMins
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  if (hours && minutes) return `${hours}h ${minutes}m`
  if (hours) return `${hours}h`
  return `${minutes}m`
})
</script>

<style scoped>
.scrum-entry {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--color-border);
}

.scrum-entry:last-child {
  border-bottom: none;
}

.entry-main {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  min-width: 0;
}

.entry-ticket {
  flex-shrink: 0;
  font-family: var(--font-mono, monospace);
  font-size: 0.8rem;
  color: var(--color-primary);
}

.entry-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-duration {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-muted);
  font-size: 0.85rem;
}
</style>
