<template>
  <div class="settings-section">
    <h2>OneNote Configuration</h2>
    <div class="settings-form">
      <div class="form-group checkbox">
        <input v-model="props.formData.syncEnabled" type="checkbox" id="onenote-sync" />
        <label for="onenote-sync">Enable OneNote Synchronization</label>
      </div>

      <div class="form-group">
        <label>Notebook</label>
        <div class="input-with-button">
          <select
            v-model="props.formData.notebookId"
            :disabled="props.notebooks.length === 0"
            @change="$emit('notebook-changed')"
          >
            <option value="">
              {{ props.notebooks.length === 0 ? 'Load notebooks to choose one' : 'Select a notebook' }}
            </option>
            <option v-for="notebook in props.notebooks" :key="notebook.id" :value="notebook.id">
              {{ notebook.displayName }}
            </option>
          </select>
          <button type="button" class="btn-secondary" :disabled="props.isLoadingNotebooks" @click="$emit('load-notebooks')">
            {{ props.isLoadingNotebooks ? 'Loading…' : 'List Notebooks' }}
          </button>
        </div>
      </div>

      <div class="form-group" v-if="props.availableSections.length > 0">
        <label>General notes section</label>
        <select v-model="props.formData.sectionId">
          <option value="">Select a section</option>
          <option v-for="section in props.availableSections" :key="section.id" :value="section.id">
            {{ section.displayName }}
          </option>
        </select>
        <div class="form-hint">Notes with no ticket number are backed up here, grouped by topic.</div>
      </div>

      <div class="form-group" v-if="props.availableSections.length > 0">
        <label>Ticket notes section</label>
        <select v-model="props.formData.ticketSectionId">
          <option value="">Same as general notes section</option>
          <option v-for="section in props.availableSections" :key="section.id" :value="section.id">
            {{ section.displayName }}
          </option>
        </select>
        <div class="form-hint">Notes tied to a ticket are backed up here, one page per ticket.</div>
      </div>

      <div
        v-if="props.availableSections.length === 0 && (props.formData.sectionName || props.formData.ticketSectionName)"
        class="form-hint"
      >
        Saved sections — general: <strong>{{ props.formData.sectionName || 'none' }}</strong>,
        ticket: <strong>{{ props.formData.ticketSectionName || 'same as general' }}</strong>.
        Load notebooks to change them.
      </div>

      <div v-if="props.notebookError" class="form-hint error-hint">⚠️ {{ props.notebookError }}</div>

      <div class="info-box">
        <span class="info-icon">ℹ️</span>
        <div>
          <p><strong>About OneNote Sync:</strong></p>
          <p>
            Notes are backed up to OneNote when you press Sync on the Notes page.
            Each ticket gets its own page and each topic gets a page for general notes;
            re-syncing rewrites those pages rather than creating duplicates.
          </p>
        </div>
      </div>

      <div class="form-hint">
        💡 Requires Microsoft authentication to be configured
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OneNoteNotebook, OneNoteSection, OneNoteSettingsForm } from '@/features/settings/models/settings'

const props = defineProps<{
  formData: OneNoteSettingsForm
  notebooks: OneNoteNotebook[]
  availableSections: OneNoteSection[]
  isLoadingNotebooks: boolean
  notebookError: string
}>()

defineEmits<{
  'load-notebooks': []
  'notebook-changed': []
}>()
</script>

<style scoped>
.error-hint {
  background: rgba(239, 68, 68, 0.1);
  border-bottom-color: var(--color-danger);
  color: var(--color-danger-soft);
}
</style>
