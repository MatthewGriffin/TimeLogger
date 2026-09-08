import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useConfigStore } from '@/shared/stores/config'
import { useEntriesStore } from '@/shared/stores/entries'
import { localDate as today } from '@/shared/utils/dates'

export const useAppStore = defineStore('app', () => {
  const isInitialized = ref(false)
  const isInitializing = ref(false)
  const startupError = ref('')
  let initializationPromise: Promise<void> | null = null

  const initializeApp = async () => {
    if (isInitialized.value) return
    if (initializationPromise) return initializationPromise
    isInitializing.value = true
    startupError.value = ''
    initializationPromise = (async () => {
      const configStore = useConfigStore()
      const entriesStore = useEntriesStore()
      const date = today()
      entriesStore.selectedDate = date
      const results = await Promise.allSettled([
        configStore.hasLoaded ? Promise.resolve() : configStore.loadConfig(),
        // Lunch is a recurring commitment, so make sure today's entry exists
        // before entries are read; the tool is idempotent and never overwrites
        // time the user already logged.
        //
        // Calendar sync is deliberately not run here. It spawns Outlook over
        // COM and any meeting it cannot map to a ticket has to be put to the
        // user, which cannot be done from startup. The pages that display the
        // day own that decision instead.
        entriesStore.ensureLunchEntry(date)
          .then(() => entriesStore.loadEntries(date))
      ])
      const failures = results.filter(result => result.status === 'rejected')
      if (failures.length) {
        startupError.value = failures.map(result => result.status === 'rejected' ? (result.reason instanceof Error ? result.reason.message : 'Startup request failed') : '').filter(Boolean).join('; ')
      }
      isInitialized.value = true
    })().finally(() => {
      isInitializing.value = false
      initializationPromise = null
    })
    return initializationPromise
  }

  return { isInitialized, isInitializing, startupError, initializeApp }
})
