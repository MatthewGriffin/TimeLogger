<template>
  <div class="notes-page page-shell">
    <!-- Page Header -->
    <div class="page-header">
      <h1>Notes</h1>
      <div class="header-actions">
        <button
          class="btn-sync"
          :disabled="notesStore.isSyncing || notesStore.notes.length === 0"
          :title="oneNoteReady ? 'Back up notes to OneNote' : 'Configure OneNote in Settings first'"
          @click="syncOneNote"
        >
          {{ notesStore.isSyncing ? '⏳ Syncing…' : '📤 Sync to OneNote' }}
        </button>
        <button class="btn-new-note" @click="openNewNote">+ New Note</button>
      </div>
    </div>

    <div v-if="syncMessage" :class="['sync-message', { error: syncFailed }]">{{ syncMessage }}</div>

    <!-- Main Content -->
    <div class="notes-layout">
      <!-- Sidebar - Topics -->
      <div class="notes-sidebar">
        <div class="search-box">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search notes..."
            class="search-input"
          />
        </div>

        <div class="topics-list">
          <div
            v-for="topic in notesStore.topics"
            :key="topic"
            :class="['topic-item', { active: notesStore.selectedTopic === topic }]"
            @click="notesStore.setSelectedTopic(topic)"
          >
            <span class="topic-name">{{ topic }}</span>
            <span class="topic-count">{{ notesStore.notesCount[topic] }}</span>
          </div>
        </div>
      </div>

      <!-- Main Content Area -->
      <div class="notes-main">
        <!-- Current Topic Header -->
        <div class="notes-header">
          <h2>{{ notesStore.selectedTopic }}</h2>
          <span class="notes-count">{{ visibleNotes.length }} notes</span>
        </div>

        <!-- Notes List -->
        <div v-if="visibleNotes.length > 0" class="notes-list">
          <div
            v-for="note in visibleNotes"
            :key="note.id"
            :class="['note-item', { synced: note.oneNoteSynced }]"
          >
            <div class="note-header">
              <h3>{{ note.title }}</h3>
              <span
                v-if="note.isBlocker && !note.blockerResolvedAt"
                class="blocker-badge"
                title="Open blocker, shown on the Daily Scrum page"
              >🚧</span>
              <span v-if="note.oneNoteSynced" class="sync-badge">📤</span>
            </div>
            <span v-if="note.ticketId" class="note-ticket">{{ note.ticketId }}</span>
            <p class="note-preview">{{ truncate(note.content, 100) }}</p>
            <div class="note-footer">
              <span class="note-time">{{ formatDate(note.updatedAt) }}</span>
              <div class="note-actions">
                <button class="btn-icon" @click.stop="editNote(note)" title="Edit">✏️</button>
                <button
                  class="btn-icon delete"
                  @click.stop="deleteNote(note.id)"
                  title="Delete"
                  :disabled="notesStore.isLoading"
                >🗑️</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Empty State -->
        <div v-else class="empty-state">
          <div class="empty-icon">📝</div>
          <p>No notes in {{ notesStore.selectedTopic }}</p>
          <p class="empty-hint">Create a new note to get started</p>
        </div>
      </div>
    </div>

    <!-- Note Editor Modal -->
    <div v-if="notesStore.showNoteEditor" class="modal-overlay" @click.self="closeEditor">
      <div class="modal">
        <div class="modal-header">
          <h2>{{ notesStore.editingNote?.id ? 'Edit Note' : 'New Note' }}</h2>
          <button class="modal-close" @click="closeEditor">✕</button>
        </div>

        <form @submit.prevent="saveNote" class="note-form">
          <div class="form-group">
            <label>Title *</label>
            <input
              v-model="notesStore.editingNote!.title"
              type="text"
              placeholder="Note title"
              required
              autofocus
            />
          </div>

          <!-- Topic is picked by the local AI on save; editing an existing
               note still lets the user override that choice. A note linked
               to a ticket is always filed under its ticket number, so the
               override is not offered in that case. -->
          <div v-if="notesStore.editingNote?.id && !editorTicketId" class="form-group">
            <label>Topic *</label>
            <select v-model="notesStore.editingNote!.topic" required>
              <option v-for="topic in notesStore.topics" :key="topic" :value="topic">
                {{ topic }}
              </option>
            </select>
          </div>
          <p v-else-if="editorTicketId" class="field-hint">
            Topic is <strong>{{ editorTicketId }}</strong> — ticket notes are filed under their ticket number
            and back up to your OneNote tickets section.
          </p>
          <p v-else class="field-hint">Topic will be set automatically by AI just after saving.</p>

          <div class="form-group">
            <div class="form-label-with-button">
              <label>Task / Ticket</label>
              <button
                v-if="configStore.isJiraConfigured()"
                type="button"
                class="btn-ai"
                @click="findJiraTicketForNote"
                :disabled="jiraStore.isSearching"
                title="Look up the Jira ticket for this note"
              >
                {{ jiraStore.isSearching ? '⏳' : '🔍' }}
              </button>
            </div>
            <input
              v-model="notesStore.editingNote!.ticketId"
              type="text"
              placeholder="e.g., PROJ-123"
              list="note-recent-tickets"
            />
            <datalist id="note-recent-tickets">
              <option v-for="ticket in recentTickets" :key="ticket" :value="ticket" />
            </datalist>
            <div v-if="jiraStore.matches.length > 0" class="ticket-suggestions">
              <div
                v-for="match in jiraStore.matches"
                :key="match.key"
                class="ticket-match"
                @click="applyJiraMatch(match)"
              >
                <span class="ticket-match-key">{{ match.key }}</span>
                <span class="ticket-match-summary">{{ match.summary }}</span>
              </div>
            </div>
          </div>

          <div class="form-group">
            <label>Content *</label>
            <textarea
              v-model="notesStore.editingNote!.content"
              placeholder="Write your note here..."
              required
              rows="10"
              ref="noteContentInput"
            />
          </div>

          <div class="form-group checkbox blocker-toggle">
            <input
              id="note-is-blocker"
              v-model="notesStore.editingNote!.isBlocker"
              type="checkbox"
            />
            <label for="note-is-blocker">🚧 This is a blocker</label>
            <span class="field-hint">
              Blockers stay on the Daily Scrum page until you resolve them.
            </span>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn-secondary" @click="closeEditor">Cancel</button>
            <button type="submit" class="btn-primary" :disabled="notesStore.isLoading">
              {{ notesStore.editingNote?.id ? 'Update Note' : 'Create Note' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- New Topic Confirmation Modal -->
    <div v-if="pendingTopicSuggestion" class="modal-overlay" @click.self="useExistingTopic">
      <div class="modal modal-small">
        <div class="modal-header">
          <h2>🆕 New Topic Suggested</h2>
          <button class="modal-close" @click="useExistingTopic">✕</button>
        </div>
        <p class="new-topic-copy">
          <strong>"{{ pendingNoteSave?.title || 'Your note' }}"</strong> is saved. The AI thinks it belongs to a new
          topic, <strong>"{{ pendingTopicSuggestion.topic }}"</strong>, which doesn't exist yet.
          Add it as a new topic, or file the note under one you already have?
        </p>
        <div class="form-group">
          <label for="fallback-topic">Existing topic</label>
          <select id="fallback-topic" v-model="fallbackTopic">
            <option v-for="topic in notesStore.topics" :key="topic" :value="topic">
              {{ topic }}
            </option>
          </select>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" @click="useExistingTopic">Use "{{ fallbackTopic }}" instead</button>
          <button class="btn-primary" @click="confirmNewTopic">✓ Add "{{ pendingTopicSuggestion.topic }}"</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useNotesStore, DEFAULT_TOPIC } from '@/features/notes/stores/notes'
import type { Note, TopicSuggestion } from '@/features/notes/stores/notes'
import { useUiStore } from '@/shared/stores/ui'
import { useConfigStore } from '@/shared/stores/config'
import { useJiraStore } from '@/shared/stores/jira'
import type { JiraMatch } from '@/shared/stores/jira'
import { useEntriesStore } from '@/shared/stores/entries'

const notesStore = useNotesStore()
const uiStore = useUiStore()
const configStore = useConfigStore()
const jiraStore = useJiraStore()
const entriesStore = useEntriesStore()

const pendingTopicSuggestion = ref<TopicSuggestion | null>(null)
const pendingNoteSave = ref<{ id: string; title: string } | null>(null)
// Which existing topic to use if the user declines the AI's new one.
const fallbackTopic = ref<string>(DEFAULT_TOPIC)

/** Move an already-saved note into the chosen topic. */
const applyTopicToPendingNote = async (id: string, topic: string) => {
  const note = notesStore.notes.find(existing => existing.id === id)
  if (!note) return
  await notesStore.updateNote(id, note.title, note.content, topic, note.ticketId)
}

// The ticket currently typed into the editor, if any. A note linked to a
// ticket is always filed under that ticket number rather than a topic.
const editorTicketId = computed(() => (notesStore.editingNote?.ticketId || '').trim())

const recentTickets = computed(() => {
  const tickets = new Set<string>()
  notesStore.notes.forEach(note => { if (note.ticketId) tickets.add(note.ticketId) })
  const entries = Array.isArray(entriesStore.entries) ? entriesStore.entries : []
  entries.forEach(entry => { if (entry.ticketId) tickets.add(entry.ticketId) })
  const issues = Array.isArray(entriesStore.recentIssues) ? entriesStore.recentIssues : []
  issues.forEach(issue => tickets.add(issue.key))
  return Array.from(tickets).slice(0, 10)
})

const findJiraTicketForNote = async () => {
  const note = notesStore.editingNote
  if (!note) return
  const query = (note.title || '').trim() || (note.ticketId || '').trim()
  if (!query) {
    uiStore.showError('Enter a title or ticket ID to search for')
    return
  }
  try {
    const matches = await jiraStore.findTicket(query)
    if (matches.length === 0) uiStore.showInfo(jiraStore.error || `No Jira tickets found for "${query}"`)
  } catch (err) {
    uiStore.reportError(err, 'Jira ticket lookup failed')
  }
}

const applyJiraMatch = (match: JiraMatch) => {
  if (notesStore.editingNote) notesStore.editingNote.ticketId = match.key
  jiraStore.clear()
}

const searchQuery = ref('')
const syncMessage = ref('')
const syncFailed = ref(false)
const noteContentInput = ref<HTMLTextAreaElement | null>(null)

const oneNoteReady = computed(() => {
  const config = configStore.config.oneNote
  return Boolean(config?.syncEnabled && config?.sectionId)
})

const syncOneNote = async () => {
  syncMessage.value = ''
  syncFailed.value = false
  try {
    const result = await notesStore.syncAllToOneNote() as { message?: string } | undefined
    syncMessage.value = result?.message || 'Notes backed up to OneNote'
    uiStore.showSuccess(syncMessage.value)
  } catch (err) {
    syncFailed.value = true
    syncMessage.value = err instanceof Error ? err.message : 'OneNote sync failed'
    uiStore.showError(syncMessage.value)
  }
}

const visibleNotes = computed(() => {
  if (!searchQuery.value) {
    return notesStore.notesByTopic
  }
  return notesStore.searchNotes(searchQuery.value)
    .filter(n => n.topic === notesStore.selectedTopic)
})

const truncate = (text: string, length: number) => {
  return text.length > length ? text.substring(0, length) + '...' : text
}

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString()
}

const openNewNote = () => {
  notesStore.setEditingNote({
    id: '',
    title: '',
    content: '',
    topic: notesStore.selectedTopic,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    oneNoteSynced: false,
    ticketId: '',
    isBlocker: false
  })
  notesStore.showNoteEditor = true
}

const editNote = (note: Note) => {
  notesStore.setEditingNote({ ...note })
  notesStore.showNoteEditor = true
}

const deleteNote = async (noteId: string) => {
  try {
    await notesStore.deleteNote(noteId)
    uiStore.showSuccess('Note deleted')
  } catch {
    uiStore.showError(notesStore.error || 'Failed to delete note')
  }
}

const closeEditor = () => {
  notesStore.setEditingNote(null)
  notesStore.showNoteEditor = false
}

const saveNote = async () => {
  const note = notesStore.editingNote
  if (!note) return

  if (!note.content.trim()) {
    uiStore.showError('Please fill in content')
    return
  }

  try {
    if (note.id) {
      // Update existing note; the topic here is the user's explicit choice.
      await notesStore.updateNote(
        note.id,
        note.title,
        note.content,
        note.topic,
        note.ticketId,
        note.isBlocker
      )
      uiStore.showSuccess('Note updated')
      closeEditor()
    } else {
      // New note: save it straight away so writing a note is never held up
      // by the local model, then work out the topic in the background. A
      // ticket-linked note already knows its topic and skips the AI.
      const created = await notesStore.createNote(
        note.title,
        note.content,
        note.ticketId ? undefined : DEFAULT_TOPIC,
        note.ticketId,
        undefined,
        note.isBlocker
      )
      uiStore.showSuccess('Note created')
      closeEditor()
      if (!note.ticketId) categorizeInBackground(created)
    }
  } catch (error) {
    uiStore.showError(notesStore.error || 'Failed to save note')
  }
}

/**
 * Work out a saved note's topic without blocking the user. The note already
 * exists by this point, so a slow or busy model only delays the note moving
 * out of the default topic - it never delays the save itself.
 */
const categorizeInBackground = async (note: Note) => {
  try {
    const suggestion = await notesStore.suggestTopic(note.content, note.ticketId, note.title)
    // The user may have deleted or edited the note while the AI was thinking.
    const current = notesStore.notes.find(existing => existing.id === note.id)
    if (!current || current.topic !== DEFAULT_TOPIC) return
    if (suggestion.topic === DEFAULT_TOPIC) return

    if (suggestion.isNew) {
      // A brand-new topic still needs the user's say-so before it appears.
      pendingTopicSuggestion.value = suggestion
      pendingNoteSave.value = { id: note.id, title: note.title }
      const topics = notesStore.topics
      fallbackTopic.value = topics.includes(DEFAULT_TOPIC) ? DEFAULT_TOPIC : (topics[0] || DEFAULT_TOPIC)
      return
    }
    await notesStore.updateNote(note.id, current.title, current.content, suggestion.topic, current.ticketId)
  } catch {
    // Categorisation is best-effort: the note keeps the default topic.
  }
}

const confirmNewTopic = async () => {
  const suggestion = pendingTopicSuggestion.value
  const pending = pendingNoteSave.value
  if (!suggestion || !pending) return
  try {
    await applyTopicToPendingNote(pending.id, suggestion.topic)
    uiStore.showSuccess(`Note filed under new topic "${suggestion.topic}"`)
  } catch (error) {
    uiStore.showError(notesStore.error || 'Failed to set topic')
  } finally {
    pendingTopicSuggestion.value = null
    pendingNoteSave.value = null
  }
}

// Declining the AI's new topic files the note under whichever existing topic
// the user picked in the dropdown rather than always falling back to General.
const useExistingTopic = async () => {
  const pending = pendingNoteSave.value
  if (!pending) { pendingTopicSuggestion.value = null; return }
  const topic = fallbackTopic.value || DEFAULT_TOPIC
  try {
    await applyTopicToPendingNote(pending.id, topic)
    uiStore.showSuccess(`Note filed under "${topic}"`)
  } catch (error) {
    uiStore.showError(notesStore.error || 'Failed to save note')
  } finally {
    pendingTopicSuggestion.value = null
    pendingNoteSave.value = null
  }
}

onMounted(async () => {
  try {
    await notesStore.loadNotesFromBackend()
  } catch (error) {
    console.error('Failed to load notes:', error)
  }
  // Needed so the sync button can say whether OneNote is actually configured.
  try {
    await configStore.loadConfigFromBackend()
  } catch (error) {
    console.error('Failed to load config:', error)
  }
  // Powers the recent-ticket suggestions in the note editor.
  try {
    await entriesStore.loadRecentIssues()
  } catch (error) {
    console.error('Failed to load recent issues:', error)
  }
})

// Lets the tray menu's "Add Note" item open a fresh note editor and drop
// focus straight into the content field, even if this page was already open.
const onFocusRequest = (event: Event) => {
  if ((event as CustomEvent<string>).detail !== 'note') return
  openNewNote()
  nextTick(() => noteContentInput.value?.focus())
}

window.addEventListener('timelogger:focus-request', onFocusRequest)
onUnmounted(() => window.removeEventListener('timelogger:focus-request', onFocusRequest))
</script>

<style scoped>

/* Page Header */
.page-header h1 {
  font-size: 1.8rem;
  font-weight: 700;
}

.header-actions {
  display: flex;
  gap: 0.75rem;
  align-items: center;
}

.btn-sync {
  padding: 0.75rem 1.25rem;
  background: rgba(148, 163, 184, 0.12);
  color: var(--color-text);
  border: 1px solid var(--color-border-stronger);
  border-radius: 0.5rem;
  cursor: pointer;
  font-weight: 600;
  transition: background 0.2s ease, border-color 0.2s ease;
}

.btn-sync:hover:not(:disabled) {
  background: var(--color-border-strong);
  border-color: rgba(148, 163, 184, 0.5);
}

.btn-sync:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.sync-message {
  margin: 1rem 3rem 0;
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  background: rgba(16, 185, 129, 0.12);
  border: 1px solid rgba(16, 185, 129, 0.35);
  color: #a7f3d0;
  font-size: 0.9rem;
}

.sync-message.error {
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.4);
  color: #fecaca;
}

.btn-new-note {
  padding: 0.75rem 1.5rem;
  background: linear-gradient(135deg, var(--color-accent), var(--color-accent-strong));
  color: var(--color-on-accent);
  border: none;
  border-radius: 0.5rem;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.3s ease;
  font-size: 0.95rem;
}

.btn-new-note:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 16px var(--color-accent-ring);
}

/* Layout */
.notes-layout {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* Sidebar */
.notes-sidebar {
  width: 250px;
  background: rgba(20, 30, 50, 0.8);
  border-right: 1px solid var(--color-border);
  padding: 1.5rem 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.search-box {
  padding: 0 1rem 1rem;
}

.search-input {
  width: 100%;
  padding: 0.75rem;
  background: var(--color-control);
  border: 1px solid var(--color-border-strong);
  border-radius: 0.5rem;
  color: var(--color-text);
  font-size: 0.9rem;
  transition: all 0.3s ease;
}

.search-input:focus {
  outline: none;
  border-color: var(--color-accent);
  background: var(--color-control-hover);
}

.topics-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0 0.5rem;
}

.topic-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  border-radius: 0.5rem;
  transition: all 0.3s ease;
  font-weight: 500;
}

.topic-item:hover {
  background: var(--color-control);
  color: var(--color-text);
}

.topic-item.active {
  background: var(--color-accent-muted);
  color: var(--color-accent);
  border-bottom: 2px solid var(--color-accent);
  padding-bottom: calc(0.75rem - 2px);
}

.topic-count {
  font-size: 0.85rem;
  background: var(--color-control);
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  color: var(--color-text-subtle);
}

/* Main Content */
.notes-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 2rem 3rem;
  overflow-y: auto;
}

.notes-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--color-border);
}

.notes-header h2 {
  font-size: 1.5rem;
  font-weight: 700;
}

.notes-count {
  font-size: 0.9rem;
  color: var(--color-text-subtle);
}

/* Notes List */
.notes-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.note-item {
  padding: 1.5rem;
  background: linear-gradient(135deg, rgba(30, 41, 59, 0.8), rgba(15, 23, 42, 0.6));
  border: 1px solid var(--color-border);
  border-radius: 0.75rem;
  cursor: pointer;
  transition: all 0.3s ease;
}

.note-item:hover {
  border-color: var(--color-border-stronger);
  background: linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(20, 30, 50, 0.8));
  transform: translateX(4px);
}

.note-item.synced {
  border-color: rgba(16, 185, 129, 0.3);
  background: linear-gradient(135deg, rgba(30, 41, 59, 0.85), rgba(15, 23, 42, 0.65));
}

.note-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.note-header h3 {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--color-text);
  flex: 1;
}

.sync-badge {
  font-size: 1rem;
}

.blocker-badge {
  font-size: 1rem;
}

.blocker-toggle {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.blocker-toggle input {
  width: auto;
  margin: 0;
}

.blocker-toggle label {
  margin: 0;
  cursor: pointer;
}

.blocker-toggle .field-hint {
  flex-basis: 100%;
}

.note-preview {
  color: var(--color-text-muted);
  font-size: 0.95rem;
  line-height: 1.5;
  margin-bottom: 1rem;
}

.note-ticket {
  display: inline-block;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-accent);
  background: rgba(6, 182, 212, 0.12);
  padding: 0.15rem 0.5rem;
  border-radius: 0.25rem;
  margin-bottom: 0.5rem;
}

.note-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.note-actions {
  display: flex;
  gap: 0.5rem;
}

.note-time {
  font-size: 0.85rem;
  color: var(--color-text-subtle);
}

.btn-icon {
  background: none;
  border: none;
  color: var(--color-accent);
  font-size: 1.2rem;
  cursor: pointer;
  transition: all 0.3s ease;
  padding: 0.25rem;
}

.btn-icon:hover:not(:disabled) {
  transform: scale(1.2);
  color: var(--color-accent-strong);
}

.btn-icon:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-icon.delete:hover:not(:disabled) {
  color: var(--color-danger);
}

/* Empty State */
.empty-icon {
  font-size: 3rem;
  margin-bottom: 1rem;
}

.empty-hint {
  font-size: 0.9rem;
  margin-top: 0.5rem;
  color: #64748b;
}

/* Modal */
.modal {
  max-width: 600px;
  max-height: 90vh;
  overflow-y: auto;
}

.modal-small {
  max-width: 420px;
}

.new-topic-copy {
  color: var(--color-text-muted);
  line-height: 1.6;
  margin: 0;
}

.modal-header h2 {
  font-size: 1.3rem;
  font-weight: 700;
}

.modal-close:hover {
  color: var(--color-text);
}

/* Form */
.note-form {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group label {
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--color-text-muted);
}

.form-group input,
.form-group select,
.form-group textarea {
  padding: 0.75rem;
  background: var(--color-control);
  border: 1px solid var(--color-border-strong);
  border-radius: 0.5rem;
  color: var(--color-text);
  font-size: 0.95rem;
  font-family: inherit;
  transition: all 0.3s ease;
}

.form-group input:focus,
.form-group select:focus,
.form-group textarea:focus {
  outline: none;
  border-color: var(--color-accent);
  background: var(--color-control-hover);
}

.form-group textarea {
  resize: vertical;
  font-family: 'Space Mono', monospace;
}

.field-hint {
  margin: -0.5rem 0 0;
  font-size: 0.85rem;
  color: var(--color-text-subtle);
  font-style: italic;
}

.form-label-with-button {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.btn-ai {
  padding: 0.25rem 0.6rem;
  background: rgba(6, 182, 212, 0.15);
  border: 1px solid rgba(6, 182, 212, 0.4);
  border-radius: 0.375rem;
  color: var(--color-accent);
  font-size: 0.85rem;
  cursor: pointer;
  transition: background 0.2s ease;
}

.btn-ai:hover:not(:disabled) {
  background: var(--color-accent-ring);
}

.btn-ai:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.ticket-suggestions {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  max-height: 160px;
  overflow-y: auto;
}

.ticket-match {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 0.75rem;
  background: var(--color-control);
  border-radius: 0.375rem;
  cursor: pointer;
  transition: background 0.2s ease;
}

.ticket-match:hover {
  background: var(--color-control-hover);
}

.ticket-match-key {
  font-weight: 600;
  color: var(--color-accent);
}

.ticket-match-summary {
  color: var(--color-text-muted);
  font-size: 0.85rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.btn-primary:hover {
  transform: translateY(-2px);
}

.btn-secondary:hover {
  background: var(--color-control-hover);
}

/* Scrollbar */
.notes-sidebar::-webkit-scrollbar,
.notes-main::-webkit-scrollbar,
.modal::-webkit-scrollbar {
  width: 6px;
}

.notes-sidebar::-webkit-scrollbar-track,
.notes-main::-webkit-scrollbar-track,
.modal::-webkit-scrollbar-track {
  background: transparent;
}

.notes-sidebar::-webkit-scrollbar-thumb,
.notes-main::-webkit-scrollbar-thumb,
.modal::-webkit-scrollbar-thumb {
  background: var(--color-border-strong);
  border-radius: 3px;
}

.notes-sidebar::-webkit-scrollbar-thumb:hover,
.notes-main::-webkit-scrollbar-thumb:hover,
.modal::-webkit-scrollbar-thumb:hover {
  background: rgba(148, 163, 184, 0.4);
}

/* Responsive */
@media (max-width: 1024px) {
  .notes-main {
    padding: 1.5rem;
  }

  .notes-sidebar {
    width: 200px;
  }
}

@media (max-width: 768px) {
  .notes-layout {
    flex-direction: column;
  }

  .notes-sidebar {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--color-border);
    height: auto;
    padding: 1rem 0;
  }

  .topics-list {
    flex-direction: row;
    overflow-x: auto;
    padding: 0 1rem;
  }

  .topic-item {
    flex-shrink: 0;
  }

  .notes-main {
    padding: 1.5rem;
  }

  .page-header {
    padding: 1.5rem;
  }
}

</style>
