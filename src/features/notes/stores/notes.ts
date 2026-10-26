import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { executeApi, ApiError } from '@/shared/utils/api'
import { normalizeNotes, type Note, type NoteTopic } from '@/shared/utils/state-adapters'
import { localDate } from '@/shared/utils/dates'
import type { TopicSuggestion } from '@/features/notes/models/notes'

export type { Note, NoteTopic }
export type { TopicSuggestion } from '@/features/notes/models/notes'

// General is the only built-in topic. Every other topic exists purely
// because a note uses it, so a category disappears once its last note does.
export const DEFAULT_TOPIC: NoteTopic = 'General'

export const useNotesStore = defineStore('notes', () => {
  const notes = ref<Note[]>([])
  const savedTopics = ref<NoteTopic[]>([DEFAULT_TOPIC])
  const selectedTopic = ref<NoteTopic>('General')
  const editingNote = ref<Note | null>(null)
  const showNoteEditor = ref(false)
  const isSyncing = ref(false)
  const isLoading = ref(false)
  const isSuggestingTopic = ref(false)
  const categorizingNoteIds = ref<string[]>([])
  const pendingTopicSuggestions = ref<Record<string, TopicSuggestion>>({})
  const error = ref('')
  // Saved categories persist even when no notes are currently filed under them.
  const topics = computed<NoteTopic[]>(() => {
    const seen: NoteTopic[] = [...savedTopics.value]
    notes.value.forEach(note => {
      const topic = note.topic
      if (topic && !seen.some(existing => existing.toLowerCase() === topic.toLowerCase())) seen.push(topic)
    })
    return seen
  })
  const notesByTopic = computed(() => notes.value.filter(note => note.topic === selectedTopic.value))
  const notesCount = computed(() => {
    const counts: Record<NoteTopic, number> = {}
    topics.value.forEach(topic => { counts[topic] = 0 })
    notes.value.forEach(note => {
      counts[note.topic] = (counts[note.topic] || 0) + 1
    })
    return counts
  })

  // Filtering by a topic that no longer has any notes would show an empty
  // page with no way back, so fall back to the default topic.
  watch(topics, current => {
    if (!current.some(topic => topic === selectedTopic.value)) selectedTopic.value = DEFAULT_TOPIC
  })

  const loadNoteTopics = async () => {
    try {
      const result = await executeApi<{ topics?: string[] }>('get_note_topics', {})
      const incoming = Array.isArray(result?.topics) ? result.topics : [DEFAULT_TOPIC]
      savedTopics.value = [DEFAULT_TOPIC, ...incoming.filter(topic => topic && topic.toLowerCase() !== DEFAULT_TOPIC.toLowerCase())]
    } catch {
      // Notes still work if category listing is temporarily unavailable.
    }
  }

  const createNoteTopic = async (name: string): Promise<NoteTopic> => {
    const result = await executeApi<{ success?: boolean; topic?: string; message?: string }>('create_note_topic', { topic: name })
    if (result?.success === false || !result?.topic) throw new Error(result?.message || 'Failed to create category')
    const topic = result.topic
    if (!savedTopics.value.some(existing => existing.toLowerCase() === topic.toLowerCase())) savedTopics.value.push(topic)
    return topic
  }

  const loadNotes = async (topic?: NoteTopic, date?: string) => {
    isLoading.value = true; error.value = ''
    try {
      const result = await executeApi('get_notes', { ...(topic ? { topic } : {}), ...(date ? { date } : {}) })
      notes.value = normalizeNotes(result)
      await loadNoteTopics()
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : 'Failed to load notes'
      try {
        const stored = localStorage.getItem('timelogger_notes')
        if (stored) notes.value = normalizeNotes(JSON.parse(stored))
      } catch { /* malformed fallback is ignored */ }
      throw err
    } finally { isLoading.value = false }
  }

  /**
   * Ask the local AI which topic fits a note. When it proposes something
   * outside the known topic list, `isNew` is set so the caller can confirm
   * with the user before the topic is actually used. A ticket-linked note
   * always resolves to its ticket number without involving the AI.
   */
  const isCategorizing = (id: string) => categorizingNoteIds.value.includes(id)
  const setCategorizing = (id: string, value: boolean) => {
    categorizingNoteIds.value = value
      ? [...new Set([...categorizingNoteIds.value, id])]
      : categorizingNoteIds.value.filter(existing => existing !== id)
  }
  const setPendingTopicSuggestion = (id: string, suggestion: TopicSuggestion) => {
    pendingTopicSuggestions.value = { ...pendingTopicSuggestions.value, [id]: suggestion }
  }
  const clearPendingTopicSuggestion = (id: string) => {
    const next = { ...pendingTopicSuggestions.value }
    delete next[id]
    pendingTopicSuggestions.value = next
  }

  const suggestTopic = async (note: string, ticketId?: string, title?: string): Promise<TopicSuggestion> => {
    const ticket = (ticketId || '').trim()
    if (ticket) return { topic: ticket, isNew: false }
    isSuggestingTopic.value = true
    try {
      const result = await executeApi<{ success?: boolean; topic?: string; isNew?: boolean; knownTopics?: string[] }>(
        'suggest_note_topic',
        { note, title: title || undefined }
      )
      const topic = result?.topic || 'General'
      return { topic, isNew: Boolean(result?.isNew) }
    } catch {
      return { topic: 'General', isNew: false }
    } finally {
      isSuggestingTopic.value = false
    }
  }

  // `topic` is optional: leave it unset on create and the backend has the
  // local AI pick one, so the user is not forced to choose. A ticket-linked
  // note always uses its ticket number as the topic (enforced server-side
  // too) so it groups onto that ticket's OneNote page.
  const createNote = async (title: string, content: string, topic: NoteTopic | undefined, ticketId?: string, date = localDate(), isBlocker = false) => {
    isLoading.value = true; error.value = ''
    try {
      const ticket = (ticketId || '').trim()
      const requestedTopic = ticket || topic
      const result = await executeApi('create_note', { date, note: content, title: title || undefined, ...(requestedTopic ? { topic: requestedTopic } : {}), ticket_id: ticket || undefined, is_blocker: isBlocker })
      const raw = result as Record<string, unknown>
      const id = raw.noteId ?? raw.id
      if (id == null) throw new Error('Backend did not return a note ID')
      const assignedTopic = (typeof raw.topic === 'string' ? raw.topic as NoteTopic : undefined) || requestedTopic || 'General'
      const now = new Date().toISOString()
      const created: Note = { id: String(id), title, content, topic: assignedTopic, createdAt: now, updatedAt: now, oneNoteSynced: false, date, ticketId: ticket || undefined, isBlocker }
      notes.value.unshift(created); syncNotesPersist()
      return created
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : String(err); throw err
    } finally { isLoading.value = false }
  }

  const updateNote = async (id: string, title: string, content: string, topic?: NoteTopic, ticketId?: string, isBlocker?: boolean) => {
    isLoading.value = true; error.value = ''
    try {
      const existing = notes.value.find(note => note.id === id)
      if (!existing) throw new Error('Note not found')
      const resolvedTicketId = (ticketId !== undefined ? ticketId : existing.ticketId) || ''
      // Linking to a ticket overrides any topic the user picked.
      const resolvedTopic = resolvedTicketId.trim() || topic || existing.topic
      const resolvedBlocker = isBlocker !== undefined ? isBlocker : existing.isBlocker
      await executeApi('update_note', { id: Number(id), note: content, topic: resolvedTopic, title: title || undefined, ticket_id: resolvedTicketId || undefined, ...(isBlocker !== undefined ? { is_blocker: isBlocker } : {}) })
      const updated = { ...existing, title, content, topic: resolvedTopic, ticketId: resolvedTicketId || undefined, isBlocker: resolvedBlocker, updatedAt: new Date().toISOString() }
      const index = notes.value.findIndex(note => note.id === id)
      notes.value[index] = updated; syncNotesPersist()
      return updated
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : String(err); throw err
    } finally { isLoading.value = false }
  }

  const deleteNote = async (id: string) => {
    isLoading.value = true; error.value = ''
    try {
      await executeApi('delete_note', { id: Number(id) })
      notes.value = notes.value.filter(note => note.id !== id); syncNotesPersist()
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : String(err); throw err
    } finally { isLoading.value = false }
  }
  const setEditingNote = (note: Note | null) => { editingNote.value = note }
  const setSelectedTopic = (topic: NoteTopic) => { selectedTopic.value = topic }
  const searchNotes = (query: string) => notes.value.filter(note => `${note.title}\n${note.content}`.toLowerCase().includes(query.toLowerCase()))
  const syncToOneNote = async (noteId: string) => {
    isSyncing.value = true
    error.value = ''
    try {
      const result = await executeApi<{ success?: boolean; message?: string; synced?: number }>(
        'onenote_sync_notes',
        { noteIds: [Number(noteId)] }
      )
      if (result?.success === false) throw new Error(result.message || 'OneNote sync failed')
      await loadNotes()
      return result
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : String(err)
      throw err
    } finally { isSyncing.value = false }
  }

  /**
   * Back up every note that is new or edited since the last run. `force`
   * rewrites all pages, for recovering after a page is deleted in OneNote.
   */
  const syncAllToOneNote = async (force = false) => {
    isSyncing.value = true
    error.value = ''
    try {
      const result = await executeApi<{ success?: boolean; message?: string; synced?: number; pages?: number }>(
        'onenote_sync_notes',
        force ? { force: true } : {}
      )
      if (result?.success === false) throw new Error(result.message || 'OneNote sync failed')
      await loadNotes()
      return result
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : String(err)
      throw err
    } finally { isSyncing.value = false }
  }
  const loadNotesFromBackend = () => loadNotes()
  const syncNotesPersist = () => localStorage.setItem('timelogger_notes', JSON.stringify(notes.value))

  return {
    notes, savedTopics, selectedTopic, editingNote, showNoteEditor, isSyncing, isLoading, isSuggestingTopic, categorizingNoteIds, pendingTopicSuggestions, error, topics, notesByTopic, notesCount,
    loadNotes, loadNoteTopics, createNoteTopic, createNote, updateNote, deleteNote, setEditingNote, setSelectedTopic, searchNotes, syncToOneNote,
    syncAllToOneNote, suggestTopic, isCategorizing, setCategorizing, setPendingTopicSuggestion, clearPendingTopicSuggestion,
    loadNotesFromBackend, syncNotesPersist
  }
})
