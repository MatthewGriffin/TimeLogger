<template>
  <div class="settings-section">
    <h2>About TimeLogger</h2>
    <div class="settings-form">
      <div class="about-card">
        <div class="about-item">
          <span class="about-label">Application Version</span>
          <span class="about-value">v0.2.0</span>
        </div>
        <div class="about-item">
          <span class="about-label">Build Date</span>
          <span class="about-value">{{ buildDate }}</span>
        </div>
        <div class="about-item">
          <span class="about-label">Tauri Version</span>
          <span class="about-value">2.11.4</span>
        </div>
      </div>

      <div class="button-group" style="flex-direction: column; gap: 0.75rem;">
        <button class="btn-secondary" @click="$emit('check-updates')">🔄 Check for Updates</button>
        <button class="btn-secondary" @click="$emit('open-documentation')">📖 View Documentation</button>
        <button class="btn-secondary" @click="$emit('report-issue')">🐛 Report Issue</button>
      </div>

      <div class="info-box">
        <span class="info-icon">ℹ️</span>
        <div>
          <p><strong>TimeLogger</strong> - A simple and elegant time tracking application</p>
          <p>Built with Vue 3, Tauri, Vite, and TypeScript for maximum performance and reliability.</p>
          <p><strong>Features:</strong> Jira integration, Tempo tracking, Microsoft Graph, Ollama AI, OneNote sync, and more.</p>
        </div>
      </div>
      <div class="info-box">
        <span class="info-icon">📜</span>
        <div>
          <p><strong>License:</strong> MIT License</p>
          <p>This project is open source and available on GitHub.</p>
        </div>
      </div>
      <div class="form-hint">💡 Thank you for using TimeLogger! We're continuously improving the app based on your feedback.</div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ buildDate: string }>()
defineEmits<{
  'check-updates': []
  'open-documentation': []
  'report-issue': []
}>()
</script>
