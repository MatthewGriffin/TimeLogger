<template>
  <section class="scrum-summary">
    <header class="summary-header">
      <h2>What to say</h2>
      <div class="summary-actions">
        <span class="summary-source">{{ sourceLabel }}</span>
        <button type="button" class="btn-secondary" :disabled="regenerating" @click="emit('regenerate')">
          {{ regenerating ? 'Writing...' : 'Regenerate' }}
        </button>
        <button type="button" class="btn-primary" @click="copy">
          {{ copied ? 'Copied' : 'Copy' }}
        </button>
      </div>
    </header>

    <p class="summary-text">{{ summary }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{
  summary: string
  source: 'ai' | 'fallback'
  regenerating: boolean
}>()
const emit = defineEmits<{ regenerate: [] }>()

const copied = ref(false)

const sourceLabel = computed(() =>
  props.source === 'ai' ? 'Written by local AI' : 'Composed from your entries'
)

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

.summary-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.summary-source {
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.summary-text {
  margin: 0;
  font-size: 1.05rem;
  line-height: 1.6;
  user-select: text;
}
</style>
