import { defineStore } from 'pinia'\nimport { invoke } from '@tauri-apps/api/core'
import { ref } from 'vue'
import { useConfigStore } from '@/shared/stores/config'
import { useEntriesStore } from '@/shared/stores/entries'
import { localDate as today } from '@/shared/utils/dates'

export const useAppStore = defineStore('app', () => {
  const isInitialized = ref(false)
  const isInitializing = ref(false)
  const startupError = ref('')
  let initializationPromise: Promise<void> | null = null

const waitForBackend = async () => {
  // The app and its initial route can mount in the same render cycle. Keep
  // backend startup inside the shared initialization promise so no page can
  // call API tools before the sidecar is listening.
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if (await invoke<boolean>('backend_health')) return
    } catch {
      // Not ready yet.
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('The TimeLogger backend did not start. Check that Node.js is installed and see backend_output.log.')
}

  const initializeApp = async () => {
    if (isInitialized.value) return
    if (initializationPromise) return initializationPromise
    isInitializing.value = true
    startupError.value = ''
    initializationPromise = (async () => {
      // Start the sidecar before the first route is allowed to initialize
      // config or entries. App.vue and the Dashboard can both request startup;
      // this promise guarantees only one start/health-check sequence runs.
      await invoke<string>('start_backend')
      await waitForBackend()

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
