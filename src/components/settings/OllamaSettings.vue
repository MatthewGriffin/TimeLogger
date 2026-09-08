<template>
  <div class="settings-section">
    <h2>Ollama AI Settings</h2>
    <div class="settings-form">
      <div class="form-group checkbox">
        <input v-model="props.formData.enabled" type="checkbox" id="ollama-enabled" />
        <label for="ollama-enabled">Enable AI features (task name suggestions, note enhancement, daily summaries)</label>
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
        💡 Ollama is used for AI-powered task suggestions, summaries, and note enhancement. All processing happens locally on your machine.
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { OllamaSettingsForm } from '../../models/settings'

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
