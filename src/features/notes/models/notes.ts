import type { NoteTopic } from '@/shared/models/note'

export interface BackendNote {
  [key: string]: unknown
}

export interface TopicSuggestion {
  topic: NoteTopic
  isNew: boolean
}
