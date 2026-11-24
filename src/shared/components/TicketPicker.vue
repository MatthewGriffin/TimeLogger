<template>
  <div class="ticket-picker">
    <div class="picker-scroll">
      <div v-if="shownMatches.length" class="picker-section">
        <span v-if="label" class="picker-label">{{ label }}</span>
        <button
          v-for="match in shownMatches"
          :key="match.key"
          type="button"
          class="ticket-match"
          @click="emit('select', match)"
        >
          <span class="ticket-match-key">{{ match.key }}</span>
          <span class="ticket-match-summary">{{ match.summary }}</span>
          <span v-if="match.status" class="ticket-match-status">{{ match.status }}</span>
        </button>
      </div>
      <p v-else-if="matches.length" class="picker-empty">Every ticket found already has an entry today.</p>

      <div v-if="shownTimeTickets.length" class="picker-section">
        <label class="time-toggle">
          <input v-model="showTimeTickets" type="checkbox">
          <span>Show time tickets ({{ shownTimeTickets.length }})</span>
        </label>
        <template v-if="showTimeTickets">
          <button
            v-for="match in shownTimeTickets"
            :key="match.key"
            type="button"
            class="ticket-match"
            @click="emit('select', match)"
          >
            <span class="ticket-match-key">{{ match.key }}</span>
            <span class="ticket-match-summary">{{ match.summary }}</span>
          </button>
        </template>
      </div>
    </div>
    <p v-if="hiddenCount" class="picker-hidden">{{ hiddenCount }} already added today, so left out.</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { JiraMatch } from '@/shared/models/jira'

/**
 * The list every Jira ticket lookup shows. It scrolls once it is long, hides the
 * tickets that already have an entry today, and keeps the time tickets (which
 * would otherwise bury the rest) behind a tick box.
 */
const props = defineProps<{
  matches: JiraMatch[]
  timeTickets?: JiraMatch[]
  /** Ticket keys to leave out, such as those already logged today. */
  exclude?: string[]
  label?: string
}>()

const emit = defineEmits<{ select: [match: JiraMatch] }>()

const showTimeTickets = ref(false)

const excluded = computed(() => new Set((props.exclude ?? []).map(key => key.toLowerCase())))
const keep = (match: JiraMatch) => !excluded.value.has(match.key.toLowerCase())

const shownMatches = computed(() => props.matches.filter(keep))
const shownTimeTickets = computed(() => (props.timeTickets ?? []).filter(keep))
const hiddenCount = computed(() =>
  props.matches.length - shownMatches.value.length + (props.timeTickets ?? []).length - shownTimeTickets.value.length)
</script>

<style scoped>
.picker-scroll { max-height: min(45vh, 28rem); overflow-y: auto; padding-right: .25rem; }
.picker-section { margin-bottom: 1rem; }
.picker-label { display: block; font-weight: 600; font-size: .9rem; color: var(--color-text-muted); margin-bottom: .5rem; }
.ticket-match {
  display: flex;
  align-items: baseline;
  gap: .75rem;
  width: 100%;
  padding: .75rem 1rem;
  margin-bottom: .5rem;
  background: var(--color-control);
  border: 1px solid var(--color-border-strong);
  border-radius: .5rem;
  color: var(--color-text-muted);
  font: inherit;
  font-size: .95rem;
  text-align: left;
  cursor: pointer;
  transition: background .15s ease, border-color .15s ease;
}
.ticket-match:hover, .ticket-match:focus-visible { background: rgba(6, 182, 212, .12); border-color: rgba(6, 182, 212, .45); }
.ticket-match-key { flex-shrink: 0; color: var(--color-accent); font-weight: 600; }
.ticket-match-summary { flex: 1; word-break: break-word; }
.ticket-match-status { flex-shrink: 0; color: var(--color-text-subtle); font-size: .8rem; }
.time-toggle { display: flex; align-items: center; gap: .5rem; margin-bottom: .5rem; font-weight: 600; font-size: .9rem; color: var(--color-text-muted); cursor: pointer; }
.picker-empty, .picker-hidden { margin: .25rem 0 0; font-size: .85rem; color: var(--color-text-subtle); }
</style>
