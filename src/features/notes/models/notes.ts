import type { NoteTopic } from '@/shared/models/note'

export interface TopicSuggestion {
  topic: NoteTopic
  isNew: boolean
  /** The local AI couldn't be asked, so the topic is only the default. */
  unavailable?: boolean
}
