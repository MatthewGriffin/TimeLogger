<template>
  <a v-if="url" :href="url" @click.prevent="openTicket">{{ label }}</a>
  <span v-else>{{ label }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useConfigStore } from '@/shared/stores/config'
import { useUiStore } from '@/shared/stores/ui'
import { useTimeTickets } from '@/shared/composables/useTimeTickets'

const props = defineProps<{ ticketId: string }>()
const configStore = useConfigStore()
const uiStore = useUiStore()
const { labelFor } = useTimeTickets()

// A time ticket also shows its PI and type, such as "PI 44 TIME-1234 Daily Scrum".
const label = computed(() => labelFor(props.ticketId))

const url = computed(() => {
  const baseUrl = String(configStore.config.jira?.baseUrl || '').replace(/\/+$/, '')
  return baseUrl ? `${baseUrl}/browse/${encodeURIComponent(props.ticketId)}` : ''
})

// The webview drops target="_blank" clicks, so the native host opens the link.
const openTicket = async () => {
  try {
    await invoke('open_external_url', { url: url.value })
  } catch (error) {
    uiStore.showError(error instanceof Error ? error.message : String(error) || 'Could not open the ticket.')
  }
}
</script>
