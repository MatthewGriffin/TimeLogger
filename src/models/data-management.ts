export interface DatabaseInfo {
  path: string
  size: string
  sizeBytes: number
  counts: {
    entries: number
    notes: number
    submissionHistory: number
  }
}

export interface ExportResult {
  format: 'json' | 'csv'
  content: string
  count: number
  suggestedName: string
}

export interface ImportResult {
  imported: Record<string, number>
  total: number
  duplicates: number
}

export interface ClearResult {
  deleted: Record<string, number>
  total: number
}
