import type { NoteTopic } from './note'

export interface BackendNote {
  [key: string]: unknown
}

export interface TopicSuggestion {
  topic: NoteTopic
  isNew: boolean
}
