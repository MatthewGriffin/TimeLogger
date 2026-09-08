<template>
  <div class="settings-section">
    <h2>Ollama AI Settings</h2>
    <div class="settings-form">
      <div class="form-group checkbox">
        <input v-model="props.formData.enabled" type="checkbox" id="ollama-enabled" />
        <label for="ollama-enabled">Enable AI features (task name suggestions, note topic sorting, daily summaries)</label>
      </div>

      <div class="form-group">
        <label>Host Address *</label>
        <input
          v-model="props.formData.host"
          type="text"
          placeholder="http://localhost:11434"
          @change="$emit('validate-host')"
        />
        <span class="form-hint-small">Default: http://localhost:11434</span>
      </div>

      <div class="form-group">
        <label>Model</label>
        <div class="model-row">
          <select v-model="props.formData.model">
            <option v-if="props.formData.model && !modelOptions.includes(props.formData.model)" :value="props.formData.model">
              {{ props.formData.model }}
            </option>
            <option v-for="model in modelOptions" :key="model" :value="model">{{ model }}</option>
          </select>
          <button type="button" class="btn btn-secondary" :disabled="loadingModels" @click="refreshModels">
            {{ loadingModels ? 'Loading…' : 'Refresh Models' }}
          </button>
        </div>
        <span v-if="modelsError" class="form-hint-small error-text">{{ modelsError }}</span>
        <span v-else class="form-hint-small">Models installed locally in Ollama. Click Refresh to fetch the latest list.</span>
      </div>

      <div class="form-group">
        <label>Temperature (Creativity): {{ props.formData.temperature?.toFixed(2) || 0.7 }}</label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          v-model.number="props.formData.temperature"
          class="slider"
        />
        <div class="slider-labels">
          <span>Deterministic</span>
          <span>Creative</span>
        </div>
        <span class="form-hint-small">Lower = more consistent, Higher = more creative</span>
      </div>

      <div class="form-hint">
        💡 Ollama is used for AI-powered task suggestions, daily summaries, and sorting notes into topics. All processing happens locally on your machine.
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { OllamaSettingsForm } from '@/features/settings/models/settings'

const props = defineProps<{
  formData: OllamaSettingsForm
}>()

defineEmits<{
  'validate-host': []
}>()

const modelOptions = ref<string[]>([])
const loadingModels = ref(false)
const modelsError = ref('')

const refreshModels = async () => {
  loadingModels.value = true
  modelsError.value = ''
  try {
    const result = await invoke<{ success: boolean; message: string; models?: string[] }>('test_ollama_connection', {
      host: props.formData.host,
    })
    modelOptions.value = result.models || []
    if (!result.success) {
      modelsError.value = result.message
    } else if (!modelOptions.value.length) {
      modelsError.value = 'Connected, but no models are installed in Ollama yet.'
    }
  } catch (error) {
    modelsError.value = error instanceof Error ? error.message : String(error)
  } finally {
    loadingModels.value = false
  }
}

onMounted(refreshModels)
</script>

<style scoped>
/* Sliders */
.slider {
  width: 100%;
  height: 6px;
  /* Matches the shared `.form-group input` radius in styles/forms.css. This
     rule used to read 3px, but plain `.slider` never outranked that shared
     selector so the value was dead; scoping this block would have silently
     started applying it. Pinned to the value that actually rendered. */
  border-radius: 0.5rem;
  background: var(--color-control);
  outline: none;
  -webkit-appearance: none;
  appearance: none;
  cursor: pointer;
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--color-accent);
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 4px var(--color-accent-ring);
}

.slider::-webkit-slider-thumb:hover {
  background: var(--color-accent-strong);
  box-shadow: 0 4px 8px rgba(6, 182, 212, 0.5);
  transform: scale(1.1);
}

.slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--color-accent);
  cursor: pointer;
  border: none;
  transition: all 0.2s ease;
  box-shadow: 0 2px 4px var(--color-accent-ring);
}

.slider::-moz-range-thumb:hover {
  background: var(--color-accent-strong);
  box-shadow: 0 4px 8px rgba(6, 182, 212, 0.5);
  transform: scale(1.1);
}

.slider::-moz-range-track {
  background: transparent;
  border: none;
}

.slider::-moz-range-progress {
  background: var(--color-accent-ring);
  height: 6px;
  border-radius: 3px;
}

.slider-labels {
  display: flex;
  justify-content: space-between;
  font-size: 0.8rem;
  color: var(--color-text-subtle);
  margin-top: 0.25rem;
}

.model-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.model-row select {
  flex: 1;
}
</style>
