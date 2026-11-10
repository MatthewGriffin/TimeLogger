<template>
  <span :title="text">{{ text }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useTimeTickets } from '@/shared/composables/useTimeTickets'

/**
 * A ticket key for a list or table. A time ticket also shows its PI and type,
 * such as "PI 44 TIME-1234 Daily Scrum", and any other ticket shows just its key.
 */
const props = defineProps<{ ticketId: string | null | undefined; empty?: string }>()

const { labelFor } = useTimeTickets()
const text = computed(() => labelFor(props.ticketId) || props.empty || '')
</script>
