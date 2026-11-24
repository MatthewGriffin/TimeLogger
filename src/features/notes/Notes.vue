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
          <button class="btn-add-topic" type="button" @click="openNewCategory">+ Category</button>
          <button
            v-for="topic in notesStore.topics"
            :key="topic"
            type="button"
            :class="['topic-item', { active: notesStore.selectedTopic === topic }]"
            :aria-pressed="notesStore.selectedTopic === topic"
            @click="notesStore.setSelectedTopic(topic)"
            @contextmenu.prevent="openCategoryMenu($event, topic)"
          >
            <span class="topic-name">{{ topic }}</span>
            <span class="topic-count">{{ notesStore.notesCount[topic] }}</span>
          </button>
        </div>

        <div
          v-if="categoryMenu"
          class="category-context-menu"
          role="menu"
          :style="{ left: `${categoryMenu.x}px`, top: `${categoryMenu.y}px` }"
          @click.stop
        >
          <div class="category-context-title">{{ categoryMenu.topic }}</div>
          <button
            v-if="categoryMenu.topic.toLowerCase() !== DEFAULT_TOPIC.toLowerCase()"
            type="button"
            role="menuitem"
            class="category-context-delete"
            @click="deleteCategoryFromMenu"
          >Delete category…</button>
          <button type="button" role="menuitem" @click="closeCategoryMenu">Cancel</button>
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
            @click="onNoteRowClick(note)"
          >
            <div class="note-header">
              <h3><button type="button" class="note-open" @click.stop="viewNote(note)">{{ noteHeading(note) }}</button></h3>
              <span
                v-if="note.isBlocker"
                :class="['blocker-status', note.blockerResolvedAt ? 'resolved' : 'open']"
                :title="blockerHint(note)"
              >{{ blockerLabel(note) }}</span>
              <span v-if="note.oneNoteSynced" class="sync-badge">📤</span>
            </div>
            <span v-if="note.ticketId" class="note-ticket"><TicketLabel :ticket-id="note.ticketId" /></span>
            <div v-if="notesStore.isCategorizing(note.id)" class="note-ai-status" role="status" aria-live="polite">
              <span class="note-ai-spinner" aria-hidden="true"></span>
              AI is deciding this note's category…
            </div>
            <div v-if="notesStore.pendingTopicSuggestions[note.id]" class="pending-topic" @click.stop>
              <div class="pending-topic-copy">
                <strong>AI category suggestion</strong>
                <span>Review or edit the suggested category before filing this note.</span>
              </div>
              <div class="pending-topic-actions">
                <input
                  type="text"
                  :aria-label="`Edit suggested category for ${noteHeading(note)}`"
                  :list="`note-categories-${note.id}`"
                  :value="pendingCategoryChoices[note.id] ?? notesStore.pendingTopicSuggestions[note.id].topic"
                  maxlength="30"
                  placeholder="Category name"
                  @input="setPendingCategoryChoice(note.id, ($event.target as HTMLInputElement).value)"
                  @keydown.enter.prevent="applyPendingTopic(note.id, pendingCategoryChoices[note.id] ?? notesStore.pendingTopicSuggestions[note.id].topic)"
                />
                <datalist :id="`note-categories-${note.id}`">
                  <option v-for="topic in notesStore.topics" :key="topic" :value="topic" />
                </datalist>
                <button
                  class="btn-primary btn-topic-accept"
                  :disabled="!(pendingCategoryChoices[note.id] ?? notesStore.pendingTopicSuggestions[note.id].topic).trim()"
                  @click.stop="applyPendingTopic(note.id, pendingCategoryChoices[note.id] ?? notesStore.pendingTopicSuggestions[note.id].topic)"
                >Use category</button>
              </div>
            </div>
            <p v-if="notePreview(note)" class="note-preview">{{ notePreview(note) }}</p>
            <div class="note-footer">
              <span class="note-time">{{ formatDate(note.updatedAt) }}</span>
              <div class="note-actions">
                <button
                  v-if="!note.ticketId"
                  type="button"
                  class="btn-icon"
                  :disabled="notesStore.isCategorizing(note.id)"
                  :aria-label="`Ask AI to re-categorize note: ${noteHeading(note)}`"
                  title="Ask AI to re-categorize this note"
                  @click.stop="recategorize(note)"
                >🏷️</button>
                <button type="button" class="btn-icon" @click.stop="editNote(note)" :aria-label="`Edit note: ${noteHeading(note)}`" title="Edit">✏️</button>
                <button
                  class="btn-icon delete"
                  type="button"
                  @click.stop="deleteNote(note.id)"
                  :aria-label="`Delete note: ${noteHeading(note)}`"
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

    <!-- Note Viewer Modal -->
    <div v-if="viewingNote" class="modal-overlay" @click.self="closeViewer">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="note-viewer-title">
        <div class="modal-header">
          <h2 id="note-viewer-title">{{ viewingNote.title || 'Note' }}</h2>
          <button ref="viewerCloseButton" type="button" class="modal-close" aria-label="Close note" @click="closeViewer">✕</button>
        </div>
        <p
          v-if="viewingNote.isBlocker"
          :class="['blocker-status', 'blocker-status-detail', viewingNote.blockerResolvedAt ? 'resolved' : 'open']"
        >
          {{ blockerLabel(viewingNote) }}<span class="blocker-status-hint">{{ blockerHint(viewingNote) }}</span>
        </p>
        <dl class="note-details">
          <div><dt>Category</dt><dd>{{ viewingNote.topic }}</dd></div>
          <div v-if="viewingNote.ticketId"><dt>Ticket</dt><dd><TicketLabel :ticket-id="viewingNote.ticketId" /></dd></div>
          <div><dt>Updated</dt><dd>{{ new Date(viewingNote.updatedAt).toLocaleString() }}</dd></div>
        </dl>
        <p class="note-full-text">{{ viewingNote.content }}</p>
        <div class="modal-footer">
          <button type="button" class="btn-secondary" @click="closeViewer">Close</button>
          <button
            v-if="viewingNote.isBlocker"
            type="button"
            class="btn-secondary"
            @click="toggleBlockerResolved(viewingNote)"
          >{{ viewingNote.blockerResolvedAt ? 'Reopen blocker' : 'Mark resolved' }}</button>
          <button type="button" class="btn-primary" @click="editViewedNote">Edit</button>
        </div>
      </div>
    </div>

    <!-- New category -->
    <div v-if="newCategory" class="modal-overlay" @click.self="closeNewCategory">
      <div class="modal modal-small" role="dialog" aria-modal="true" aria-labelledby="new-category-title">
        <div class="modal-header">
          <h2 id="new-category-title">New category</h2>
          <button type="button" class="modal-close" aria-label="Close" @click="closeNewCategory">✕</button>
        </div>
        <form class="note-form" @submit.prevent="submitNewCategory">
          <div class="form-group">
            <label for="new-category-name">Category name</label>
            <input id="new-category-name" ref="newCategoryInput" v-model="newCategory.name" type="text" maxlength="30" autocomplete="off" placeholder="e.g. Architecture">
          </div>
          <p v-if="newCategory.error" class="field-hint category-error" role="alert">{{ newCategory.error }}</p>
          <div class="modal-footer">
            <button type="button" class="btn-secondary" @click="closeNewCategory">Cancel</button>
            <button type="submit" class="btn-primary" :disabled="newCategory.saving || !newCategory.name.trim()">{{ newCategory.saving ? 'Creating…' : 'Create category' }}</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Delete a category -->
    <div v-if="categoryToDelete" class="modal-overlay" @click.self="closeDeleteCategory">
      <div class="modal modal-small" role="dialog" aria-modal="true" aria-labelledby="delete-category-title">
        <div class="modal-header">
          <h2 id="delete-category-title">Delete “{{ categoryToDelete.topic }}”</h2>
          <button type="button" class="modal-close" aria-label="Close" @click="closeDeleteCategory">✕</button>
        </div>
        <form class="note-form" @submit.prevent="submitDeleteCategory">
          <p v-if="!categoryToDelete.count" class="new-topic-copy">This category is empty. Delete it?</p>
          <template v-else>
            <p class="new-topic-copy">This category has {{ categoryToDelete.count }} note{{ categoryToDelete.count === 1 ? '' : 's' }}. What should happen to {{ categoryToDelete.count === 1 ? 'it' : 'them' }}?</p>
            <label class="choice"><input v-model="categoryToDelete.choice" type="radio" value="move"> Move {{ categoryToDelete.count === 1 ? 'it' : 'them' }} to another category</label>
            <div v-if="categoryToDelete.choice === 'move'" class="form-group">
              <label for="move-category-name">Move to</label>
              <input id="move-category-name" v-model="categoryToDelete.moveTo" type="text" maxlength="30" list="move-category-options" autocomplete="off" placeholder="An existing or new category">
              <datalist id="move-category-options">
                <option v-for="topic in notesStore.topics.filter(name => name.toLowerCase() !== categoryToDelete!.topic.toLowerCase())" :key="topic" :value="topic" />
              </datalist>
            </div>
            <label class="choice"><input v-model="categoryToDelete.choice" type="radio" value="delete"> Delete {{ categoryToDelete.count === 1 ? 'it' : 'them' }} too. This cannot be undone</label>
          </template>
          <p v-if="categoryToDelete.error" class="field-hint category-error" role="alert">{{ categoryToDelete.error }}</p>
          <div class="modal-footer">
            <button type="button" class="btn-secondary" @click="closeDeleteCategory">Cancel</button>
            <button type="submit" class="btn-primary" :class="{ danger: categoryToDelete.count > 0 && categoryToDelete.choice === 'delete' }" :disabled="categoryToDelete.saving">
              {{ categoryToDelete.saving ? 'Working…' : deleteButtonLabel }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Note Editor Modal -->
    <div v-if="notesStore.showNoteEditor" class="modal-overlay" @click.self="closeEditor">
      <div class="modal">
        <div class="modal-header">
          <h2>{{ notesStore.editingNote?.id ? 'Edit Note' : 'New Note' }}</h2>
          <button type="button" class="modal-close" aria-label="Close note editor" @click="closeEditor">✕</button>
        </div>

        <form @submit.prevent="saveNote" class="note-form">
          <p v-if="notesStore.editingNote?.title" class="field-hint">Title: {{ notesStore.editingNote.title }}</p>

          <div class="form-group">
            <label for="note-content">Note *</label>
            <textarea
              id="note-content"
              v-model="notesStore.editingNote!.content"
              placeholder="Write your note here..."
              required
              rows="10"
              ref="noteContentInput"
            />
          </div>

          <!-- Choose a category manually, or leave a new note on AI suggestion. -->
          <div v-if="!editorTicketId" class="form-group">
            <label>Category *</label>
            <select v-model="notesStore.editingNote!.topic">
              <option v-if="!notesStore.editingNote?.id" value="">Let AI suggest after saving</option>
              <option v-for="topic in notesStore.topics" :key="topic" :value="topic">
                {{ topic }}
              </option>
            </select>
            <p class="field-hint">AI suggestions are shown for approval before the category changes.</p>
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
              <option v-for="ticket in ticketOptions" :key="ticket.key" :value="ticket.key" :label="ticket.description" />
            </datalist>
            <TicketHint :ticket-id="notesStore.editingNote!.ticketId" />
            <TicketPicker v-if="jiraStore.matches.length > 0" :matches="jiraStore.matches" @select="applyJiraMatch" />
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

          <div v-if="notesStore.isLoading" class="note-save-status" role="status" aria-live="polite">
            <span class="note-save-spinner" aria-hidden="true"></span>
            Saving note…
          </div>
          <div class="modal-footer">
            <button type="button" class="btn-secondary" :disabled="notesStore.isLoading" @click="closeEditor">Cancel</button>
            <button type="submit" class="btn-primary" :disabled="notesStore.isLoading">
              {{ notesStore.isLoading ? 'Saving…' : (notesStore.editingNote?.id ? 'Update Note' : 'Create Note') }}
            </button>
          </div>
        </form>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useNotesStore, DEFAULT_TOPIC, isSameTopic } from '@/features/notes/stores/notes'
import type { Note } from '@/features/notes/stores/notes'
import { useUiStore } from '@/shared/stores/ui'
import { useConfigStore } from '@/shared/stores/config'
import { useJiraStore } from '@/shared/stores/jira'
import type { JiraMatch } from '@/shared/stores/jira'
import { useEntriesStore } from '@/shared/stores/entries'
import { useTicketOptions } from '@/shared/composables/useTicketOptions'
import TicketHint from '@/shared/components/TicketHint.vue'
import TicketPicker from '@/shared/components/TicketPicker.vue'
import TicketLabel from '@/shared/components/TicketLabel.vue'

const notesStore = useNotesStore()
const uiStore = useUiStore()
const configStore = useConfigStore()
const jiraStore = useJiraStore()
const entriesStore = useEntriesStore()

const pendingCategoryChoices = ref<Record<string, string>>({})
const categoryMenu = ref<{ topic: string; x: number; y: number } | null>(null)

const openCategoryMenu = (event: MouseEvent, topic: string) => {
  categoryMenu.value = { topic, x: event.clientX, y: event.clientY }
}
const closeCategoryMenu = () => { categoryMenu.value = null }
const deleteCategoryFromMenu = async () => {
  const topic = categoryMenu.value?.topic
  categoryMenu.value = null
  if (topic) await deleteCategory(topic)
}
const onEscapeKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return
  closeCategoryMenu()
  closeViewer()
}
window.addEventListener('keydown', onEscapeKeydown)
const originalEditingNote = ref<{ id: string; title: string; content: string; topic: string } | null>(null)
const editorTicketId = computed(() => (notesStore.editingNote?.ticketId || '').trim())

const { ticketOptions, loadPiTickets } = useTicketOptions(() =>
  notesStore.notes
    .filter(note => note.ticketId)
    .map(note => ({ key: note.ticketId as string, description: note.title }))
)

const findJiraTicketForNote = async () => {
  const note = notesStore.editingNote
  if (!note) return
  const query = (note.title || '').trim() || firstLine(note.content) || (note.ticketId || '').trim()
  if (!query) {
    uiStore.showError('Write the note or enter a ticket ID to search for')
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
    .filter(n => isSameTopic(n.topic, notesStore.selectedTopic))
})

const truncate = (text: string, length: number) => {
  return text.length > length ? text.substring(0, length) + '...' : text
}

const firstLine = (text: string) => text.split(/\r?\n/).find(line => line.trim())?.trim().slice(0, 80) ?? ''

const noteHeading = (note: Note) => note.title || firstLine(note.content)

// A note without a title is headed by its first line, so the preview carries on from there.
const notePreview = (note: Note) => {
  if (note.title) return truncate(note.content, 100)
  const text = note.content.trim()
  const lineEnd = text.search(/\r?\n/)
  const heading = firstLine(text)
  const rest = lineEnd >= 0 && heading.length === lineEnd ? text.slice(lineEnd).trim() : text.slice(heading.length).trim()
  return truncate(rest, 100)
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
  originalEditingNote.value = null
  notesStore.setEditingNote({
    id: '',
    title: '',
    content: '',
    topic: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    oneNoteSynced: false,
    ticketId: '',
    isBlocker: false
  })
  notesStore.showNoteEditor = true
  nextTick(() => noteContentInput.value?.focus())
}

const editNote = (note: Note) => {
  originalEditingNote.value = { id: note.id, title: note.title, content: note.content, topic: note.topic }
  notesStore.setEditingNote({ ...note })
  notesStore.showNoteEditor = true
}

// Held by ID so the viewer closes by itself if the note is deleted.
const viewingNoteId = ref<string | null>(null)
const viewingNote = computed(() => notesStore.notes.find(note => note.id === viewingNoteId.value) ?? null)
const viewerCloseButton = ref<HTMLButtonElement | null>(null)

const viewNote = (note: Note) => {
  viewingNoteId.value = note.id
  nextTick(() => viewerCloseButton.value?.focus())
}

const onNoteRowClick = (note: Note) => {
  // Dragging to select text in a row also ends in a click.
  if (window.getSelection()?.toString()) return
  viewNote(note)
}

const closeViewer = () => { viewingNoteId.value = null }

const blockerLabel = (note: Note) => note.blockerResolvedAt ? '✓ Resolved blocker' : '🚧 Open blocker'
const blockerHint = (note: Note) => note.blockerResolvedAt ? 'No longer shown on the Daily Scrum page' : 'Shown on the Daily Scrum page until resolved'

const toggleBlockerResolved = async (note: Note) => {
  const resolved = !note.blockerResolvedAt
  try {
    await notesStore.setBlockerResolved(note.id, resolved)
    uiStore.showSuccess(resolved ? 'Blocker resolved' : 'Blocker reopened')
  } catch {
    uiStore.showError(notesStore.error || 'Failed to update blocker')
  }
}

const editViewedNote = () => {
  const note = viewingNote.value
  closeViewer()
  if (note) editNote(note)
}

// New category: a dialog in place of the browser's prompt box.
const newCategory = ref<{ name: string; error: string; saving: boolean } | null>(null)
const newCategoryInput = ref<HTMLInputElement | null>(null)

const openNewCategory = async () => {
  newCategory.value = { name: '', error: '', saving: false }
  await nextTick()
  newCategoryInput.value?.focus()
}
const closeNewCategory = () => { newCategory.value = null }

const submitNewCategory = async () => {
  const dialog = newCategory.value
  if (!dialog) return
  const name = dialog.name.trim().replace(/\s+/g, ' ')
  if (!name) { dialog.error = 'Enter a category name'; return }
  dialog.saving = true
  dialog.error = ''
  try {
    const topic = await notesStore.createNoteTopic(name)
    newCategory.value = null
    uiStore.showSuccess(`Category "${topic}" created`)
  } catch (error) {
    dialog.error = error instanceof Error ? error.message : 'Failed to create category'
    dialog.saving = false
  }
}

// Delete category: one dialog covers an empty category, moving its notes, or deleting them too.
const categoryToDelete = ref<{ topic: string; count: number; choice: 'move' | 'delete'; moveTo: string; error: string; saving: boolean } | null>(null)

const deleteCategory = (topic: string) => {
  categoryToDelete.value = {
    topic,
    count: notesStore.notesCount[topic] || 0,
    choice: 'move',
    moveTo: DEFAULT_TOPIC,
    error: '',
    saving: false
  }
}
const closeDeleteCategory = () => { categoryToDelete.value = null }

const deleteButtonLabel = computed(() => {
  const dialog = categoryToDelete.value
  if (!dialog) return ''
  if (!dialog.count) return 'Delete category'
  return dialog.choice === 'move' ? 'Move notes and delete category' : `Delete category and ${dialog.count} note${dialog.count === 1 ? '' : 's'}`
})

const submitDeleteCategory = async () => {
  const dialog = categoryToDelete.value
  if (!dialog) return
  let moveTo: string | undefined
  if (dialog.count > 0 && dialog.choice === 'move') {
    moveTo = dialog.moveTo.trim().replace(/\s+/g, ' ')
    if (!moveTo) { dialog.error = 'Enter a destination category'; return }
    if (moveTo.toLowerCase() === dialog.topic.toLowerCase()) { dialog.error = 'Choose a different destination category'; return }
  }
  dialog.saving = true
  dialog.error = ''
  try {
    const affected = await notesStore.deleteNoteTopic(dialog.topic, moveTo)
    categoryToDelete.value = null
    uiStore.showSuccess(moveTo
      ? `Moved ${affected} note${affected === 1 ? '' : 's'} to "${moveTo}" and deleted "${dialog.topic}"`
      : `Deleted category "${dialog.topic}"${dialog.count ? ` and ${affected} note${affected === 1 ? '' : 's'}` : ''}`)
  } catch {
    dialog.error = notesStore.error || 'Failed to delete category'
    dialog.saving = false
  }
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
  originalEditingNote.value = null
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
      const original = originalEditingNote.value
      const contentChanged = Boolean(original && (note.content !== original.content || note.title !== original.title))
      const categoryChanged = Boolean(original && note.topic !== original.topic)
      if (contentChanged || categoryChanged || note.ticketId) notesStore.clearPendingTopicSuggestion(note.id)
      const updated = await notesStore.updateNote(
        note.id,
        note.title,
        note.content,
        note.topic || original?.topic,
        note.ticketId,
        note.isBlocker
      )
      const shouldCategorize = contentChanged && !categoryChanged && !note.ticketId
      uiStore.showSuccess(shouldCategorize ? 'Note updated — AI is categorizing the note' : 'Note updated')
      closeEditor()
      if (shouldCategorize) categorizeInBackground(updated)
    } else {
      // New note: save it straight away so writing a note is never held up
      // by the local model, then work out the topic in the background. A
      // ticket-linked note already knows its topic and skips the AI.
      const created = await notesStore.createNote(
        note.title,
        note.content,
        note.ticketId ? undefined : (note.topic || DEFAULT_TOPIC),
        note.ticketId,
        undefined,
        note.isBlocker
      )
      // Show the tab the note went to. An AI suggestion only moves it once approved.
      notesStore.setSelectedTopic(created.topic)
      // A search that doesn't match the note would still hide it.
      if (!notesStore.searchNotes(searchQuery.value).some(existing => existing.id === created.id)) searchQuery.value = ''
      uiStore.showSuccess('Note created')
      const shouldSuggest = !note.ticketId && !note.topic
      closeEditor()
      if (shouldSuggest) categorizeInBackground(created)
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
  notesStore.setCategorizing(note.id, true)
  try {
    const suggestion = await notesStore.suggestTopic(note.content, note.ticketId, note.title)
    // The user may have deleted or edited the note while the AI was thinking.
    const current = notesStore.notes.find(existing => existing.id === note.id)
    if (!current || current.title !== note.title || current.content !== note.content || suggestion.topic === current.topic) return
    notesStore.setPendingTopicSuggestion(note.id, suggestion)
    pendingCategoryChoices.value = { ...pendingCategoryChoices.value, [note.id]: suggestion.topic }
  } catch {
    // Categorisation is best-effort: the note keeps its current category.
  } finally {
    notesStore.setCategorizing(note.id, false)
  }
}

/**
 * Ask the AI to look at a note again without changing its text, for when the
 * category it was given is wrong. A different answer is offered for approval like
 * any other suggestion; the same answer is reported, so it doesn't look like
 * nothing happened.
 */
const recategorize = async (note: Note) => {
  if (note.ticketId || notesStore.isCategorizing(note.id)) return
  notesStore.setCategorizing(note.id, true)
  try {
    const suggestion = await notesStore.suggestTopic(note.content, note.ticketId, note.title)
    const current = notesStore.notes.find(existing => existing.id === note.id)
    if (!current) return
    if (suggestion.unavailable) {
      uiStore.showError("The local AI isn't available right now, so the category couldn't be re-checked.")
      return
    }
    if (suggestion.topic.toLowerCase() === current.topic.toLowerCase()) {
      notesStore.clearPendingTopicSuggestion(note.id)
      uiStore.showInfo(`The AI would still file this note under "${current.topic}".`)
      return
    }
    notesStore.setPendingTopicSuggestion(note.id, suggestion)
    pendingCategoryChoices.value = { ...pendingCategoryChoices.value, [note.id]: suggestion.topic }
  } finally {
    notesStore.setCategorizing(note.id, false)
  }
}

const setPendingCategoryChoice = (id: string, topic: string) => {
  pendingCategoryChoices.value = { ...pendingCategoryChoices.value, [id]: topic }
}

const applyPendingTopic = async (id: string, topic: string) => {
  const suggestion = notesStore.pendingTopicSuggestions[id]
  const note = notesStore.notes.find(existing => existing.id === id)
  const requestedTopic = topic.trim().replace(/\s+/g, ' ')
  if (!suggestion || !note || !requestedTopic) return
  if (requestedTopic.length > 30) {
    uiStore.showError('Category names must be 30 characters or fewer')
    return
  }
  try {
    // Resolve existing names case-insensitively or create a reusable category
    // before saving, whether the user accepted or edited the AI suggestion.
    const resolvedTopic = await notesStore.createNoteTopic(requestedTopic)
    await notesStore.updateNote(id, note.title, note.content, resolvedTopic, note.ticketId, note.isBlocker)
    notesStore.clearPendingTopicSuggestion(id)
    const nextChoices = { ...pendingCategoryChoices.value }
    delete nextChoices[id]
    pendingCategoryChoices.value = nextChoices
    uiStore.showSuccess(`Note filed under "${resolvedTopic}"`)
  } catch {
    uiStore.showError(notesStore.error || 'Failed to set topic')
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
  // Powers the ticket suggestions in the note editor.
  try {
    await Promise.all([entriesStore.loadRecentIssues(), loadPiTickets()])
  } catch (error) {
    console.error('Failed to load recent issues:', error)
  }
})

// Lets the tray menu's "Add Note" item open a fresh note editor and drop
// focus straight into the content field, even if this page was already open.
const onFocusRequest = (event: Event) => {
  if ((event as CustomEvent<string>).detail !== 'note') return
  openNewNote()
}

window.addEventListener('timelogger:focus-request', onFocusRequest)
onUnmounted(() => {
  window.removeEventListener('timelogger:focus-request', onFocusRequest)
  window.removeEventListener('keydown', onEscapeKeydown)
})
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

.btn-add-topic {
  width: calc(100% - 1rem);
  margin: 0 0.5rem 0.25rem;
  padding: 0.6rem 0.75rem;
  text-align: left;
  background: var(--color-control);
  color: var(--color-text);
  border: 1px dashed var(--color-border-strong);
  border-radius: 0.5rem;
  cursor: pointer;
  font-weight: 600;
}

.btn-add-topic:hover {
  border-color: var(--color-accent);
  background: var(--color-accent-muted);
}

.topic-item {
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  text-align: left;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  border-radius: 0.5rem;
  transition: all 0.3s ease;
  font-weight: 500;
}

.topic-item:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
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

.topic-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.topic-count {
  justify-self: end;
  min-width: 1.4rem;
  box-sizing: border-box;
  text-align: center;
  font-size: 0.85rem;
  background: var(--color-control);
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  color: var(--color-text-subtle);
}

.category-context-menu {
  position: fixed;
  z-index: 1200;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 10rem;
  padding: 0.4rem;
  border: 1px solid var(--color-border-strong);
  border-radius: 0.5rem;
  background: var(--color-panel, #172033);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.category-context-title {
  padding: 0.4rem 0.55rem;
  color: var(--color-text-muted);
  font-size: 0.8rem;
  overflow-wrap: anywhere;
}

.category-context-menu button {
  border: 0;
  border-radius: 0.3rem;
  padding: 0.5rem 0.55rem;
  text-align: left;
  color: var(--color-text);
  background: transparent;
  cursor: pointer;
}

.category-context-menu button:hover,
.category-context-menu button:focus-visible {
  background: var(--color-control-hover);
}

.category-context-menu .category-context-delete:hover {
  color: var(--color-danger);
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

/* Notes List: as many columns as fit, so a note doesn't stretch across a wide window. */
.notes-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 32rem), 1fr));
  align-items: start;
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

.note-open {
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  overflow-wrap: anywhere;
}

.note-details {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1.5rem;
  margin: 0 0 1rem;
  font-size: 0.875rem;
}

.note-details dt {
  color: var(--color-text-muted);
}

.note-details dd {
  margin: 0;
  color: var(--color-text);
  overflow-wrap: anywhere;
}

.note-full-text {
  margin: 0 0 1rem;
  color: var(--color-text);
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.sync-badge {
  font-size: 1rem;
}

.blocker-status {
  flex-shrink: 0;
  padding: 0.15rem 0.6rem;
  border: 1px solid;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 600;
  white-space: nowrap;
}

.blocker-status.open {
  color: var(--color-warning);
  border-color: var(--color-warning);
  background: color-mix(in srgb, var(--color-warning) 15%, transparent);
}

.blocker-status.resolved {
  color: var(--color-success);
  border-color: var(--color-success);
  background: color-mix(in srgb, var(--color-success) 12%, transparent);
}

.blocker-status-detail {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.25rem 0.75rem;
  margin: 0 0 1rem;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  font-size: 0.9rem;
  white-space: normal;
}

.blocker-status-hint {
  font-weight: 400;
  font-size: 0.8rem;
  color: var(--color-text-muted);
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

.note-save-status { display: flex; align-items: center; gap: .6rem; color: var(--color-text-muted); font-size: .9rem; padding: .5rem 0; }
.note-save-spinner { width: .9rem; height: .9rem; border: 2px solid var(--color-border); border-top-color: var(--color-accent); border-radius: 50%; animation: note-save-spin .75s linear infinite; }
@keyframes note-save-spin { to { transform: rotate(360deg); } }
.note-ai-status {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0.4rem 0;
  color: var(--color-text-muted);
  font-size: 0.8rem;
}
.note-ai-spinner {
  width: 0.8rem;
  height: 0.8rem;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: note-ai-spin .8s linear infinite;
}
.pending-topic {
  margin: 0.55rem 0;
  padding: 0.75rem;
  border: 1px solid var(--color-accent-ring);
  border-radius: 0.5rem;
  background: var(--color-accent-muted);
}
.pending-topic-copy { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.82rem; }
.pending-topic-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.45rem; margin-top: 0.6rem; }
.pending-topic-actions select,
.pending-topic-actions input { flex: 1 1 12rem; min-width: 12rem; }
.btn-topic-accept { white-space: nowrap; }
@keyframes note-ai-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .note-ai-spinner { animation: none; } }

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

.choice { display: flex; align-items: center; gap: .5rem; color: var(--color-text); cursor: pointer; }
.category-error { color: var(--color-danger); margin: 0; }
.btn-primary.danger { background: var(--color-danger); border-color: var(--color-danger); }

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

.btn-primary:hover {
  transform: translateY(-2px);
}

.btn-secondary:hover {
  background: var(--color-control-hover);
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
