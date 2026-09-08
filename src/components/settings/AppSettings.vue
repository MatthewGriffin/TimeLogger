<template>
  <div class="settings-section">
    <h2>Application Settings</h2>
    <div class="settings-form">
      <h3 class="settings-subheading">Launch & Startup</h3>
      <div class="form-group checkbox">
        <input v-model="formData.autoStart" type="checkbox" id="autostart" />
        <label for="autostart">Start Application with Windows</label>
      </div>
      <div class="form-group checkbox">
        <input v-model="formData.startMinimized" type="checkbox" id="minimized" />
        <label for="minimized">Start Minimized to System Tray</label>
      </div>

      <h3 class="settings-subheading">Lunch Break</h3>
      <div class="form-group checkbox">
        <input v-model="formData.lunch.enabled" type="checkbox" id="lunch-enabled" />
        <label for="lunch-enabled">Automatically add a lunch break to each day</label>
      </div>
      <div class="form-group">
        <label for="lunch-name">Entry Name</label>
        <input v-model="formData.lunch.name" type="text" id="lunch-name" :disabled="!formData.lunch.enabled" />
      </div>
      <div class="form-group">
        <label for="lunch-start">Start Time</label>
        <input v-model="formData.lunch.startTime" type="time" id="lunch-start" :disabled="!formData.lunch.enabled" />
      </div>
      <div class="form-group">
        <label for="lunch-end">End Time</label>
        <input v-model="formData.lunch.endTime" type="time" id="lunch-end" :disabled="!formData.lunch.enabled" />
      </div>

      <h3 class="settings-subheading">Working Hours</h3>
      <div class="form-group">
        <label for="workday-start">Day Starts</label>
        <input v-model="formData.workday.startTime" type="time" id="workday-start" />
      </div>
      <div class="form-group">
        <label for="workday-end">Day Ends</label>
        <input v-model="formData.workday.endTime" type="time" id="workday-end" />
      </div>
      <div class="form-hint">Used to log all-day calendar events such as holidays and leave.</div>

      <h3 class="settings-subheading">Theme</h3>
      <div class="form-group">
        <label>Appearance</label>
        <select v-model="formData.theme">
          <option value="auto">Auto (Match System)</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </div>

      <h3 class="settings-subheading">Notifications</h3>
      <div class="form-group checkbox">
        <input v-model="formData.notifications.enabled" type="checkbox" id="notifications-enabled" />
        <label for="notifications-enabled">Enable System Notifications</label>
      </div>
      <div class="form-group checkbox">
        <input v-model="formData.notifications.submissionAlerts" type="checkbox" id="submission-alerts" :disabled="!formData.notifications.enabled" />
        <label for="submission-alerts">Show Submission Success/Failure Alerts</label>
      </div>
      <div class="form-group checkbox">
        <input v-model="formData.notifications.dailyReminders" type="checkbox" id="daily-reminders" :disabled="!formData.notifications.enabled" />
        <label for="daily-reminders">Enable Daily Summary Reminders</label>
      </div>
      <div v-if="formData.notifications.dailyReminders" class="form-group">
        <label for="reminder-time">Reminder Time</label>
        <input v-model="formData.notifications.dailyReminderTime" type="time" id="reminder-time" />
      </div>

      <h3 class="settings-subheading">Tempo Submission Reminder</h3>
      <div class="form-group checkbox">
        <input v-model="formData.notifications.tempoReminder.enabled" type="checkbox" id="tempo-reminder" :disabled="!formData.notifications.enabled" />
        <label for="tempo-reminder">Remind me to submit my time to Tempo</label>
      </div>
      <template v-if="formData.notifications.tempoReminder.enabled">
        <div class="form-group">
          <label for="tempo-reminder-time">Remind me at</label>
          <input v-model="formData.notifications.tempoReminder.time" type="time" id="tempo-reminder-time" :disabled="!formData.notifications.enabled" />
        </div>
        <div class="form-group">
          <label for="tempo-reminder-days">How often</label>
          <select v-model="formData.notifications.tempoReminder.days" id="tempo-reminder-days" :disabled="!formData.notifications.enabled">
            <option value="weekdays">Once a day, weekdays only</option>
            <option value="everyday">Once a day, every day</option>
          </select>
          <span class="form-hint-small">Only fires when today has entries that have not been submitted, and never more than once a day.</span>
        </div>
      </template>

      <div class="form-group">
        <button class="btn-secondary" type="button" :disabled="isSendingTestNotification" @click="$emit('send-test-notification')">
          {{ isSendingTestNotification ? 'Sending…' : '🔔 Send test notification' }}
        </button>
        <span class="form-hint-small">Confirms Windows notifications are getting through.</span>
      </div>
      <div class="info-box">
        <span class="info-icon">ℹ️</span>
        <div>
          <p><strong>System Tray:</strong> The app will automatically minimize to the system tray when you close the window.</p>
          <p><strong>Double-click tray icon:</strong> Shows the app window</p>
          <p><strong>Right-click menu:</strong> Quick access to Show/Hide and Quit options</p>
        </div>
      </div>
      <div class="form-hint">🔔 Notifications appear as Windows toast messages and can be configured per notification type</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AppSettingsForm } from '../../models/settings'

defineProps<{
  formData: AppSettingsForm
  isSendingTestNotification: boolean
}>()

defineEmits<{ 'send-test-notification': [] }>()
</script>

<style scoped>
.settings-subheading {
  margin: 1.5rem 0 1rem;
  font-size: 1.1rem;
  font-weight: 600;
}
</style>
