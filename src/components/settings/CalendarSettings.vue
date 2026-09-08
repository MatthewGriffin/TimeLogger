<template>
  <div class="settings-section">
    <h2>Outlook Calendar Integration</h2>
    <div class="settings-form">
      <div class="form-group checkbox">
        <input v-model="props.formData.enabled" type="checkbox" id="calendar-enabled" />
        <label for="calendar-enabled">Enable Calendar Integration</label>
      </div>

      <div class="form-group" v-if="props.formData.enabled">
        <label>Refresh Interval</label>
        <select v-model="props.formData.refreshInterval" :disabled="!props.formData.enabled">
          <option value="15">Every 15 minutes</option>
          <option value="30">Every 30 minutes</option>
          <option value="60">Every 1 hour</option>
        </select>
      </div>

      <div class="form-group checkbox" v-if="props.formData.enabled">
        <input v-model="props.formData.includeAllDayEvents" type="checkbox" id="allday" :disabled="!props.formData.enabled" />
        <label for="allday">Show All-Day Events on the calendar</label>
      </div>
      <div class="form-hint">All-day events (holidays, leave) are logged across your working hours, set under App Settings.</div>

      <div class="form-group checkbox" v-if="props.formData.enabled">
        <input v-model="props.formData.syncOnStartup" type="checkbox" id="calendar-startup" />
        <label for="calendar-startup">Add meetings to time entries automatically</label>
      </div>

      <div class="form-group" v-if="props.formData.enabled">
        <label>Only sync events with category (optional)</label>
        <input v-model="props.formData.filterLabel" type="text" placeholder="e.g. Billable" />
        <div class="form-hint">Leave blank to sync every meeting.</div>
      </div>

      <div class="info-box">
        <span class="info-icon">ℹ️</span>
        <div>
          <p><strong>Calendar Integration:</strong></p>
          <p>Meetings are added as time entries and wrap around any time you have already logged. Syncing the same day again will not create duplicates.</p>
        </div>
      </div>

      <div class="form-hint">
        💡 Reads the Outlook desktop app on this PC — no Microsoft sign-in needed. Outlook must be installed and running.
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CalendarSettingsForm } from '../../models/settings'

const props = defineProps<{
  formData: CalendarSettingsForm
}>()
</script>
