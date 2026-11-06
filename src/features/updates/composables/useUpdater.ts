import { ref, computed } from 'vue'
import { Channel, invoke } from '@tauri-apps/api/core'
import { relaunch } from '@tauri-apps/plugin-process'
import { getVersion } from '@tauri-apps/api/app'
import { useConfigStore } from '@/shared/stores/config'
import type { UpdateChannel } from '@/shared/models/config'
import type { UpdateStage, UpdateInfo } from '@/features/updates/models/updater'

type DownloadEvent =
  | { event: 'started'; data: { contentLength: number | null } }
  | { event: 'progress'; data: { chunkLength: number } }
  | { event: 'finished' }

/**
 * The channel to use. With no saved choice, a beta build stays on beta, so
 * someone who installs a beta by hand keeps getting betas.
 */
export const effectiveUpdateChannel = (saved: UpdateChannel | undefined, version: string): UpdateChannel =>
  saved ?? (version.includes('-') ? 'beta' : 'main')

/**
 * Owns the whole update lifecycle: asking GitHub whether a newer release
 * exists, downloading it, and relaunching into it.
 *
 * State lives at module scope rather than inside the function so the startup
 * check and the Settings button drive the same dialog. Two independent copies
 * would let the app download the same update twice.
 *
 * Nothing here verifies the download - the Rust updater checks the release's
 * minisign signature against the public key baked into tauri.conf.json and
 * refuses to install anything that fails, so a tampered installer never
 * reaches the user.
 */

const stage = ref<UpdateStage>('idle')
const info = ref<UpdateInfo | null>(null)
const errorMessage = ref('')
const downloadedBytes = ref(0)
const totalBytes = ref(0)
// An available update waits behind the sidebar button until someone asks to see it.
const dialogOpen = ref(false)

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
  dialogOpen.value = false
}

const openDialog = () => {
  dialogOpen.value = true
}

/**
 * Keeps an update that hasn't been installed, including after a failed download,
 * so that the sidebar button still offers it.
 */
const closeDialog = () => {
  if (info.value && (stage.value === 'available' || stage.value === 'error')) {
    stage.value = 'available'
    errorMessage.value = ''
    dialogOpen.value = false
  } else {
    reset()
  }
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Returns true when an update was found. `silent` is used by the startup
 * check, where nothing should interrupt the user: being up to date or unable to
 * reach GitHub are both completely normal, and a new version only shows the
 * sidebar button. Asking from Settings opens the dialog straight away.
 */
const checkForUpdate = async (silent = false): Promise<boolean> => {
  if (isBusy.value) return stage.value === 'available'

  stage.value = 'checking'
  errorMessage.value = ''

  try {
    const channel = effectiveUpdateChannel(useConfigStore().config.updateChannel, await getVersion())
    const update = await invoke<UpdateInfo | null>('check_for_update', { channel })

    if (!update) {
      info.value = null
      stage.value = 'idle'
      return false
    }

    info.value = { ...update, notes: update.notes.trim() }
    stage.value = 'available'
    dialogOpen.value = !silent
    return true
  } catch (error) {
    info.value = null
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
  if (!info.value) return

  stage.value = 'downloading'
  downloadedBytes.value = 0
  totalBytes.value = 0

  try {
    const onEvent = new Channel<DownloadEvent>()
    onEvent.onmessage = (message) => {
      switch (message.event) {
        case 'started':
          totalBytes.value = message.data.contentLength ?? 0
          break
        case 'progress':
          downloadedBytes.value += message.data.chunkLength
          break
        case 'finished':
          // The installer still has to run, which takes a few seconds with no
          // further progress events, so say so rather than sitting at 100%.
          stage.value = 'installing'
          break
      }
    }
    await invoke('install_update', { onEvent })
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
    // restarts by hand. Clearing it stops the sidebar button offering it again.
    info.value = null
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
  dialogOpen,
  openDialog,
  closeDialog,
  checkForUpdate,
  downloadAndInstall,
  restartNow
})

/**
 * Fired once on launch. Deliberately silent: it never opens the dialog, and
 * only shows the sidebar button when there is something to install.
 */
export const checkForUpdateOnStartup = () => {
  void checkForUpdate(true)
}
