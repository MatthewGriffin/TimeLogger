<template>
  <div v-if="missingConfigs.length > 0" class="config-banner">
    <div class="banner-content">
      <span class="banner-icon">⚠️</span>
      <div class="banner-text">
        <p class="banner-title">Configuration Needed</p>
        <p class="banner-description">
          {{ missingConfigs.join(' • ') }}
        </p>
      </div>
      <button class="banner-button" @click="navigateToSettings">
        Go to Settings →
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useConfigStore } from '../stores/config'

const router = useRouter()
const configStore = useConfigStore()

const missingConfigs = computed(() => {
  const missing: string[] = []

  if (!configStore.isJiraConfigured()) {
    missing.push('💡 Configure Jira connection')
  }

  if (!configStore.isOllamaConfigured()) {
    missing.push('🤖 Add Ollama endpoint for AI features')
  }

  return missing
})

const navigateToSettings = () => {
  router.push('/settings')
}
</script>

<style scoped>
.config-banner {
  background: linear-gradient(135deg, rgba(251, 146, 60, 0.1), rgba(245, 158, 11, 0.1));
  border: 1px solid rgba(251, 146, 60, 0.3);
  border-left: 4px solid #fb923c;
  border-radius: 0.5rem;
  margin: 0 2rem 2rem;
  overflow: hidden;
}

.banner-content {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
}

.banner-icon {
  font-size: 1.5rem;
  flex-shrink: 0;
}

.banner-text {
  flex: 1;
}

.banner-title {
  margin: 0;
  font-weight: 600;
  font-size: 0.95rem;
  color: #fed7aa;
}

.banner-description {
  margin: 0.25rem 0 0;
  font-size: 0.85rem;
  color: #fbbf24;
  line-height: 1.4;
}

.banner-button {
  padding: 0.5rem 1rem;
  background: rgba(251, 146, 60, 0.2);
  border: 1px solid rgba(251, 146, 60, 0.4);
  color: #fb923c;
  border-radius: 0.375rem;
  cursor: pointer;
  font-weight: 500;
  font-size: 0.85rem;
  white-space: nowrap;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.banner-button:hover {
  background: rgba(251, 146, 60, 0.3);
  border-color: rgba(251, 146, 60, 0.6);
  color: #fbbf24;
}

@media (max-width: 768px) {
  .config-banner {
    margin: 0 1rem 1.5rem;
  }

  .banner-content {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .banner-button {
    align-self: flex-start;
  }
}
</style>
