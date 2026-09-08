import { ref, computed } from 'vue'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { getVersion } from '@tauri-apps/api/app'
import type { UpdateStage, UpdateInfo } from '../models/updater'

/**
 * Owns the whole update lifecycle: asking GitHub whether a newer release
 * exists, downloading it, and relaunching into it.
 *
 * State lives at module scope rather than inside the function so the startup
 * check and the Settings button drive the same dialog. Two independent copies
 * would let the app download the same update twice.
 *
 * Nothing here verifies the download - the Rust plugin checks the release's
 * minisign signature against the public key baked into tauri.conf.json and
 * refuses to install anything that fails, so a tampered installer never
 * reaches the user.
 */

const stage = ref<UpdateStage>('idle')
const info = ref<UpdateInfo | null>(null)
const errorMessage = ref('')
const downloadedBytes = ref(0)
const totalBytes = ref(0)

// The handle from `check()` must survive until the user accepts, so it is held
// outside the reactive state - it is a resource, not something to render.
let pendingUpdate: Update | null = null

const progressPercent = computed(() => {
  if (!totalBytes.value) return 0
  return Math.min(100, Math.round((downloadedBytes.value / totalBytes.value) * 100))
})

const isBusy = computed(() => stage.value === 'checking' || stage.value === 'downloading' || stage.value === 'installing')

const reset = () => {
  stage.value = 'idle'
  info.value = null
  errorMessage.value = ''
  downloadedBytes.value = 0
  totalBytes.value = 0
  pendingUpdate = null
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Returns true when an update was found. `silent` is used by the startup
 * check, where being up to date or being unable to reach GitHub are both
 * completely normal and must not interrupt the user.
 */
const checkForUpdate = async (silent = false): Promise<boolean> => {
  if (isBusy.value) return stage.value === 'available'

  stage.value = 'checking'
  errorMessage.value = ''

  try {
    const update = await check()

    if (!update) {
      pendingUpdate = null
      info.value = null
      stage.value = 'idle'
      return false
    }

    pendingUpdate = update
    info.value = {
      version: update.version,
      currentVersion: update.currentVersion || (await getVersion()),
      notes: update.body?.trim() || '',
      releaseDate: update.date || ''
    }
    stage.value = 'available'
    return true
  } catch (error) {
    pendingUpdate = null
    if (silent) {
      // No network, no release published yet, or running outside Tauri. None
      // of these are worth a dialog on launch.
      stage.value = 'idle'
      return false
    }
    errorMessage.value = describe(error)
    stage.value = 'error'
    return false
  }
}

const downloadAndInstall = async () => {
  if (!pendingUpdate) return

  stage.value = 'downloading'
  downloadedBytes.value = 0
  totalBytes.value = 0

  try {
    await pendingUpdate.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          totalBytes.value = event.data.contentLength ?? 0
          break
        case 'Progress':
          downloadedBytes.value += event.data.chunkLength
          break
        case 'Finished':
          // The installer still has to run, which takes a few seconds with no
          // further progress events, so say so rather than sitting at 100%.
          stage.value = 'installing'
          break
      }
    })
    stage.value = 'ready'
  } catch (error) {
    errorMessage.value = describe(error)
    stage.value = 'error'
  }
}

const restartNow = async () => {
  try {
    await relaunch()
  } catch (error) {
    // The update is already installed, so the worst case is that the user
    // restarts by hand.
    errorMessage.value = describe(error)
    stage.value = 'error'
  }
}

export const useUpdater = () => ({
  stage,
  info,
  errorMessage,
  downloadedBytes,
  totalBytes,
  progressPercent,
  isBusy,
  checkForUpdate,
  downloadAndInstall,
  restartNow,
  dismiss: reset
})

/**
 * Fired once on launch. Deliberately silent: it only ever opens the dialog
 * when there is genuinely something to install.
 */
export const checkForUpdateOnStartup = () => {
  void checkForUpdate(true)
}
