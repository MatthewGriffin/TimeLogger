<template>
  <small v-if="ticket" class="ticket-hint" :title="'Time ticket: ' + text">{{ text }}</small>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { timeTicketText, useTimeTickets } from '@/shared/composables/useTimeTickets'

/**
 * Shows what a time ticket is next to a ticket field, such as
 * "PI 44 TIME-1234 Daily Scrum", so a wrong pick is easy to spot. Nothing is
 * shown for any other ticket.
 */
const props = defineProps<{ ticketId: string | null | undefined }>()

const { find } = useTimeTickets()
const ticket = computed(() => find(props.ticketId))
const text = computed(() => (ticket.value ? timeTicketText(ticket.value) : ''))
</script>

<style scoped>
.ticket-hint {
  display: block;
  margin-top: 0.25rem;
  font-size: 0.78rem;
  color: var(--color-accent);
  overflow-wrap: anywhere;
}
</style>
