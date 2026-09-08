<template>
  <div class="scrum-page">
    <header class="page-header">
      <h1>Daily Scrum</h1>
      <p class="page-subtitle">Your update for stand-up, built from your logged time and notes.</p>
    </header>

    <div v-if="error" class="error-banner">{{ error }}</div>

    <div v-if="isLoading" class="loading-state">Building your update...</div>

    <template v-else-if="report">
      <ScrumSummaryCard
        :summary="report.summary"
        :source="report.summarySource"
        :regenerating="isRegenerating"
        @regenerate="regenerate(true)"
      />

      <div class="scrum-days">
        <ScrumDayPanel :day="report.yesterday" label="Yesterday" />
        <ScrumDayPanel :day="report.today" label="Today" />
      </div>

      <ScrumBlockersPanel :blockers="report.blockers" @resolve="resolveBlocker" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import ScrumSummaryCard from '@/features/scrum/components/ScrumSummaryCard.vue'
import ScrumDayPanel from '@/features/scrum/components/ScrumDayPanel.vue'
import ScrumBlockersPanel from '@/features/scrum/components/ScrumBlockersPanel.vue'
import { useScrum } from '@/features/scrum/composables/useScrum'

const { report, isLoading, isRegenerating, error, load, regenerate, resolveBlocker } = useScrum()

// The first load skips the model so the page paints immediately; the AI
// paragraph is a deliberate click, since generation can take a few seconds.
onMounted(() => load(false))
</script>

<style scoped>
.scrum-page {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 1.5rem;
}

.page-header h1 {
  margin: 0 0 0.25rem;
}

.page-subtitle {
  margin: 0;
  color: var(--color-text-muted);
}

.scrum-days {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 1.25rem;
}

.loading-state {
  padding: 2rem;
  text-align: center;
  color: var(--color-text-muted);
}

.error-banner {
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: var(--color-danger, #ef4444);
}
</style>
