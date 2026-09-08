<template>
  <section class="scrum-planned">
    <header class="planned-header">
      <div class="planned-titles">
        <h3>Planned for today</h3>
        <p class="planned-note">Intent only &mdash; no time is logged and nothing is sent to Tempo.</p>
      </div>
      <button type="button" class="planned-add" @click="emit('open-search')">
        + Add ticket
      </button>
    </header>

    <p v-if="planned.length === 0" class="planned-empty">
      Nothing planned yet. Add the tickets you intend to pick up so they appear in your update.
    </p>

    <ul v-else class="planned-list">
      <li v-for="item in planned" :key="item.id" class="planned-item">
        <div class="planned-body">
          <span class="planned-ticket">{{ item.ticketId }}</span>
          <span v-if="item.summary" class="planned-summary">{{ item.summary }}</span>
          <span v-if="item.status" class="planned-status">{{ item.status }}</span>
        </div>
        <button
          type="button"
          class="planned-remove"
          :aria-label="`Remove ${item.ticketId} from planned work`"
          @click="emit('remove', item.id)"
        >
          Remove
        </button>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import type { ScrumPlanItem } from '@/features/scrum/models/scrumPlanItem'

defineProps<{ planned: ScrumPlanItem[] }>()
const emit = defineEmits<{ 'open-search': []; remove: [id: number] }>()
</script>

<style scoped>
.scrum-planned {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 0.75rem;
  padding: 1.25rem;
}

.planned-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-md);
  margin-bottom: var(--space-sm);
  flex-wrap: wrap;
}

.planned-titles h3 {
  margin: 0;
  font-size: 1rem;
}

.planned-note {
  margin: var(--space-2xs) 0 0;
  font-size: 0.78rem;
  color: var(--color-text-subtle);
}

.planned-add {
  flex-shrink: 0;
  padding: var(--space-2xs) var(--space-sm);
  font-size: 0.8rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-accent-ring);
  background: var(--color-accent-soft);
  color: var(--color-accent);
  cursor: pointer;
}

.planned-add:hover {
  background: var(--color-accent-muted);
}

.planned-empty {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.9rem;
}

.planned-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.planned-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-xs) 0;
  border-bottom: 1px solid var(--color-border);
}

.planned-item:last-child {
  border-bottom: none;
}

.planned-body {
  display: flex;
  align-items: baseline;
  gap: var(--space-xs);
  flex-wrap: wrap;
  min-width: 0;
}

.planned-ticket {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: var(--color-accent);
}

.planned-summary {
  font-size: 0.9rem;
}

.planned-status {
  font-size: 0.72rem;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  background: var(--color-control);
  color: var(--color-text-subtle);
}

.planned-remove {
  flex-shrink: 0;
  padding: var(--space-2xs) var(--space-sm);
  font-size: 0.8rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
}

.planned-remove:hover {
  border-color: var(--color-danger);
  color: var(--color-danger-soft);
}
</style>
