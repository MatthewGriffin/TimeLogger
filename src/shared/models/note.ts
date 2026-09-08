export type NoteTopic = string

export interface Note {
  id: string
  title: string
  content: string
  topic: NoteTopic
  createdAt: string
  updatedAt: string
  oneNoteSynced: boolean
  oneNoteId?: string
  date?: string
  ticketId?: string
  isBlocker: boolean
  blockerResolvedAt?: string
}
