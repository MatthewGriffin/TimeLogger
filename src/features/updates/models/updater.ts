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

export interface ReleaseNote {
  version: string
  changes: string[]
}

/**
 * What installing this release means. `switch` is the latest stable release when
 * Stable is chosen on a newer beta build, and `rollback` is a chosen older version.
 */
export type UpdateKind = 'update' | 'switch' | 'rollback'

export interface RollbackVersion {
  version: string
  releaseDate: string
}

export interface UpdateInfo {
  kind: UpdateKind
  version: string
  currentVersion: string
  /** The manifest's notes as written, shown when `changes` is empty. */
  notes: string
  /** What changed in each version newer than the installed one, newest first. */
  changes: ReleaseNote[]
  releaseDate: string
}
