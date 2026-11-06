import { ref, computed } from 'vue'
import { Channel, invoke } from '@tauri-apps/api/core'
import { relaunch } from '@tauri-apps/plugin-process'
import { getVersion } from '@tauri-apps/api/app'
import { useConfigStore } from '@/shared/stores/config'
import type { UpdateChannel } from '@/shared/models/config'
import type { RollbackVersion, UpdateStage, UpdateInfo } from '@/features/updates/models/updater'

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
// A rollback replaces whatever update was on offer, so closing it has to find that again.
let recheckOnClose = false
let recheckTimer: ReturnType<typeof setInterval> | undefined

// Often enough for a hotfix to reach an app left open in the tray for days.
const RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

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
  if (recheckOnClose) {
    recheckOnClose = false
    reset()
    void checkForUpdate(true)
  } else if (info.value && (stage.value === 'available' || stage.value === 'error')) {
    stage.value = 'available'
    errorMessage.value = ''
    dialogOpen.value = false
  } else {
    reset()
  }
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * The channel to check. A beta build with no saved choice counts as Beta, so it's
 * saved here: otherwise moving to a stable version would silently change channel.
 */
const resolveChannel = async (): Promise<UpdateChannel> => {
  const configStore = useConfigStore()
  const saved = configStore.config.updateChannel
  const channel = effectiveUpdateChannel(saved, await getVersion())
  // Until settings have loaded, "no choice saved" can't be told apart from a
  // choice that couldn't be read, and that choice mustn't be replaced.
  if (!saved && channel === 'beta' && configStore.hasLoaded) {
    // Checking still works without this, and a later check tries the save again.
    await configStore.saveUpdateChannel(channel).catch(() => undefined)
  }
  return channel
}

/**
 * Returns true when an update was found. `silent` is used by the startup
 * check, where nothing should interrupt the user: being up to date or unable to
 * reach GitHub are both completely normal, and a new version only shows the
 * sidebar button. Asking from Settings opens the dialog straight away.
 */
const checkForUpdate = async (silent = false): Promise<boolean> => {
  if (isBusy.value) return stage.value === 'available'
  // A background check leaves an open dialog, or a finished install, alone.
  if (silent && (dialogOpen.value || (stage.value !== 'idle' && stage.value !== 'available'))) return false

  stage.value = 'checking'
  errorMessage.value = ''

  try {
    const channel = await resolveChannel()
    const update = await invoke<UpdateInfo | null>('check_for_update', { channel })

    if (!update) {
      info.value = null
      stage.value = 'idle'
      return false
    }

    info.value = { ...update, notes: update.notes.trim() }
    stage.value = 'available'
    // The sidebar button can be clicked while a background check is running.
    if (!silent) dialogOpen.value = true
    return true
  } catch (error) {
    if (silent) {
      // No network, no release published yet, or running outside Tauri. None
      // of these are worth a dialog, and an update already found still stands.
      stage.value = info.value ? 'available' : 'idle'
      return false
    }
    info.value = null
    errorMessage.value = describe(error)
    stage.value = 'error'
    return false
  }
}

const listRollbackVersions = async (): Promise<RollbackVersion[]> => {
  const channel = await resolveChannel()
  return invoke<RollbackVersion[]>('list_rollback_versions', { channel })
}

const prepareRollback = async (version: string) => {
  if (isBusy.value) return

  recheckOnClose = true
  info.value = null
  stage.value = 'checking'
  errorMessage.value = ''

  try {
    info.value = await invoke<UpdateInfo>('prepare_rollback', { version })
    stage.value = 'available'
    dialogOpen.value = true
  } catch (error) {
    errorMessage.value = describe(error)
    stage.value = 'error'
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
  listRollbackVersions,
  prepareRollback,
  downloadAndInstall,
  restartNow
})

/**
 * Checks on launch and then every few hours. Deliberately silent: it never opens
 * the dialog, and only shows the sidebar button when there is something to install.
 */
export const startUpdateChecks = () => {
  void checkForUpdate(true)
  recheckTimer = setInterval(() => void checkForUpdate(true), RECHECK_INTERVAL_MS)
}

export const stopUpdateChecks = () => {
  if (recheckTimer) clearInterval(recheckTimer)
  recheckTimer = undefined
}
