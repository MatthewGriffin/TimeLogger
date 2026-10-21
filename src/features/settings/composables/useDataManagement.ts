import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { executeApi } from '@/shared/utils/api'
import type { DatabaseInfo, ExportResult, ImportResult, ClearResult } from '@/features/settings/models/data-management'

/**
 * Backup, restore and reset.
 *
 * The backend owns the data and decides what a backup contains. File dialogs
 * and file I/O are handled by native commands so the webview never supplies an
 * arbitrary filesystem path.
 */

const busy = ref(false)

export const useDataManagement = () => {
  const getDatabaseInfo = () => executeApi<DatabaseInfo>('get_database_info')

  /**
   * Returns the saved path, or null when the user cancelled. Throws if the
   * export or the write actually failed.
   */
  const exportData = async (format: 'json' | 'csv'): Promise<string | null> => {
    busy.value = true
    try {
      const result = await executeApi<ExportResult>('export_data', { format })
      return await invoke<string | null>('write_backup_file', {
        suggestedName: result.suggestedName,
        extension: format,
        contents: result.content
      })
    } finally {
      busy.value = false
    }
  }

  const importData = async (): Promise<ImportResult | null> => {
    busy.value = true
    try {
      const contents = await invoke<string | null>('read_backup_file')
      if (contents === null) return null
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
