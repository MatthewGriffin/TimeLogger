/**
 * The stage an update is at. The dialog renders entirely from this, so every
 * visible state has exactly one name.
 */
export type UpdateStage =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'ready'
  | 'error'

export interface UpdateInfo {
  version: string
  currentVersion: string
  notes: string
  releaseDate: string
}
