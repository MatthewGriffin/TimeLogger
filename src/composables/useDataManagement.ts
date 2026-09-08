import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { save, open } from '@tauri-apps/plugin-dialog'
import { executeApi } from '../utils/api'
import type { DatabaseInfo, ExportResult, ImportResult, ClearResult } from '../models/data-management'

/**
 * Backup, restore and reset.
 *
 * The backend owns the data and decides what a backup contains; this only
 * moves that content between the database and a file the user picked. Keeping
 * the file dialogs here rather than in the settings page means the page stays
 * a page, and the "did the user cancel?" handling lives in one place instead
 * of being repeated per button.
 */

const busy = ref(false)

const cancelled = Symbol('cancelled')

/**
 * Ask for a path, returning the cancel sentinel rather than null so callers
 * can tell "user backed out" apart from "something went wrong" - the first
 * must be silent, the second must not be.
 */
const chooseSavePath = async (suggestedName: string, extension: string) => {
  const path = await save({
    defaultPath: suggestedName,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
  })
  return path ?? cancelled
}

export const useDataManagement = () => {
  const getDatabaseInfo = () => executeApi<DatabaseInfo>('get_database_info')

  /**
   * Returns the saved path, or null when the user cancelled. Throws if the
   * export or the write actually failed.
   */
  const exportData = async (format: 'json' | 'csv'): Promise<string | null> => {
    busy.value = true
    try {
      // Generated before the dialog opens so a failure surfaces before the
      // user has gone to the trouble of naming a file.
      const result = await executeApi<ExportResult>('export_data', { format })
      const path = await chooseSavePath(result.suggestedName, format)
      if (path === cancelled) return null

      await invoke<string>('write_backup_file', { path, contents: result.content })
      return path
    } finally {
      busy.value = false
    }
  }

  const importData = async (): Promise<ImportResult | null> => {
    busy.value = true
    try {
      const path = await open({
        multiple: false,
        directory: false,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (typeof path !== 'string') return null

      const contents = await invoke<string>('read_backup_file', { path })
      return await executeApi<ImportResult>('import_data', { content: contents })
    } finally {
      busy.value = false
    }
  }

  const clearAllData = async (): Promise<ClearResult> => {
    busy.value = true
    try {
      return await executeApi<ClearResult>('clear_all_data', { confirm: true })
    } finally {
      busy.value = false
    }
  }

  const openLogsFolder = () => invoke<string>('open_logs_folder')

  return { busy, getDatabaseInfo, exportData, importData, clearAllData, openLogsFolder }
}
