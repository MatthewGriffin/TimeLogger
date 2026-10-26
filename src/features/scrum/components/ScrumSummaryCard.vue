<template>
  <section class="scrum-summary">
    <header class="summary-header">
      <h2>What to say</h2>
      <button type="button" class="btn-primary" @click="copy">
        {{ copied ? 'Copied' : 'Copy' }}
      </button>
    </header>

    <div class="summary-text">
      <p v-for="(line, lineIndex) in summaryLines" :key="lineIndex" class="summary-line">
        <template v-for="(part, partIndex) in linkedParts(line)" :key="partIndex">
          <a
            v-if="part.ticket && jiraBaseUrl"
            :href="jiraBaseUrl + '/browse/' + part.text"
            target="_blank"
            rel="noopener noreferrer"
            class="ticket-link"
          >{{ part.text }}</a>
          <span v-else>{{ part.text }}</span>
        </template>
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useConfigStore } from '@/shared/stores/config'

const props = defineProps<{ summary: string }>()

const copied = ref(false)
const configStore = useConfigStore()
const jiraBaseUrl = computed(() => String(configStore.config.jira?.baseUrl || '').replace(/\/$/, ''))
const summaryLines = computed(() => props.summary.split(/\r?\n/))

const linkedParts = (line: string) => {
  const parts: Array<{ text: string; ticket: boolean }> = []
  const pattern = /\b[A-Z][A-Z0-9]{1,15}-\d+\b/g
  let lastIndex = 0
  for (const match of line.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > lastIndex) parts.push({ text: line.slice(lastIndex, index), ticket: false })
    parts.push({ text: match[0], ticket: true })
    lastIndex = index + match[0].length
  }
  if (lastIndex < line.length || parts.length === 0) parts.push({ text: line.slice(lastIndex), ticket: false })
  return parts
}

const copy = async () => {
  try {
    await navigator.clipboard.writeText(props.summary)
    copied.value = true
    window.setTimeout(() => { copied.value = false }, 2000)
  } catch {
    // Clipboard access can be refused; the text stays selectable on screen.
  }
}
</script>

<style scoped>
.scrum-summary {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 0.75rem;
  padding: 1.25rem;
}

.summary-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 0.75rem;
}

.summary-header h2 {
  margin: 0;
  font-size: 1.1rem;
}

.summary-text {
  font-size: .95rem;
  line-height: 1.5;
  user-select: text;
  overflow-wrap: anywhere;
}

.summary-line {
  margin: 0;
  white-space: pre-wrap;
}

.summary-line + .summary-line {
  margin-top: .2rem;
}

.ticket-link {
  color: var(--color-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>
