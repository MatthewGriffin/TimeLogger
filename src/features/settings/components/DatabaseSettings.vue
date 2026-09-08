<template>
  <div class="settings-section">
    <h2>Database & Data Management</h2>
    <div class="settings-form">
      <div class="form-group">
        <label>Database Location</label>
        <div class="readonly-field">{{ databasePath }}</div>
        <span class="form-hint-small">Location where all your data is stored</span>
      </div>
      <div class="form-group">
        <label>Database Size</label>
        <div class="readonly-field">{{ databaseSize }}</div>
      </div>
      <div class="form-group">
        <label>Export & Backup</label>
        <div class="button-group">
          <button class="btn-secondary" @click="$emit('export-json')">📥 Export as JSON</button>
          <button class="btn-secondary" @click="$emit('export-csv')">📥 Export as CSV</button>
        </div>
        <span class="form-hint-small">Download a backup of all your time entries and notes</span>
      </div>
      <div class="form-group">
        <label>Import Backup</label>
        <div class="button-group">
          <button class="btn-secondary" @click="$emit('import')">📤 Import Data</button>
        </div>
        <span class="form-hint-small">Restore data from a previously exported backup</span>
      </div>
      <div class="form-group">
        <label>Logs & Diagnostics</label>
        <div class="button-group">
          <button class="btn-secondary" @click="$emit('view-logs')">📋 View Logs</button>
        </div>
        <span class="form-hint-small">View application logs for debugging</span>
      </div>
      <div class="form-group">
        <label>Reset Application</label>
        <div class="button-group">
          <button class="btn-danger" @click="$emit('clear-data')">🗑️ Clear All Data</button>
        </div>
        <span class="form-hint-small">⚠️ This action cannot be undone. Make sure to backup your data first.</span>
      </div>
      <div class="info-box warning">
        <span class="info-icon">⚠️</span>
        <div>
          <p><strong>Before clearing data:</strong></p>
          <ol>
            <li>Export a backup using the Export buttons above</li>
            <li>Store the backup file in a safe location</li>
            <li>Clear All Data will reset the application completely</li>
          </ol>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  databasePath: string
  databaseSize: string
}>()

defineEmits<{
  'export-json': []
  'export-csv': []
  import: []
  'view-logs': []
  'clear-data': []
}>()
</script>

<style scoped>
/* Readonly Field */
.readonly-field {
  padding: 0.75rem;
  background: rgba(30, 41, 59, 0.5);
  border: 1px solid var(--color-border-strong);
  border-radius: 0.5rem;
  color: var(--color-text-subtle);
  font-family: 'Space Mono', monospace;
  font-size: 0.9rem;
}

/* Button Danger */
.btn-danger {
  padding: 0.75rem 1.5rem;
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.5);
  color: var(--color-danger-soft);
  border-radius: 0.5rem;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.3s ease;
  font-size: 0.95rem;
  align-self: flex-start;
}

.btn-danger:hover {
  background: rgba(239, 68, 68, 0.25);
  border-color: rgba(239, 68, 68, 0.7);
  color: var(--color-danger);
}

.btn-danger:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
