<!--
  Confirmation for an irreversible action.

  Requires the user to type the confirmation word rather than offering a
  one-click OK. Clearing every entry and note cannot be undone, and the
  native confirm() this replaced sits directly under the pointer, so a
  reflexive click could wipe months of logged time.
-->
<template>
  <transition name="confirm-danger">
    <div v-if="open" class="confirm-backdrop" @click.self="close">
      <div
        class="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-danger-title"
        aria-describedby="confirm-danger-body"
      >
        <h2 id="confirm-danger-title" class="confirm-title">{{ title }}</h2>
        <div id="confirm-danger-body">
          <p class="confirm-text"><slot /></p>
        </div>

        <label class="confirm-label" :for="inputId">
          Type <strong>{{ confirmWord }}</strong> to continue
        </label>
        <input
          :id="inputId"
          ref="inputEl"
          v-model="typed"
          class="confirm-input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          @keydown.enter="confirmIfAllowed"
        />

        <div class="confirm-actions">
          <button class="confirm-cancel" @click="close">Cancel</button>
          <button class="confirm-accept" :disabled="!matches" @click="confirmIfAllowed">
            {{ acceptLabel }}
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'

const props = withDefaults(defineProps<{
  open: boolean
  title: string
  confirmWord?: string
  acceptLabel?: string
}>(), {
  confirmWord: 'DELETE',
  acceptLabel: 'Delete everything'
})

const emit = defineEmits<{ confirm: []; cancel: [] }>()

const inputId = useId()
const typed = ref('')
const inputEl = ref<HTMLInputElement | null>(null)

// Case-insensitive: the point is deliberate intent, not typing accuracy.
const matches = computed(() => typed.value.trim().toUpperCase() === props.confirmWord.toUpperCase())

watch(() => props.open, async (isOpen) => {
  // Always reset, so reopening never arrives pre-confirmed from last time.
  typed.value = ''
  if (!isOpen) return
  await nextTick()
  inputEl.value?.focus()
})

const close = () => emit('cancel')

const confirmIfAllowed = () => {
  if (matches.value) emit('confirm')
}
</script>

<style scoped>
.confirm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: rgba(15, 23, 42, 0.7);
  backdrop-filter: blur(4px);
}

.confirm-dialog {
  width: 100%;
  max-width: 28rem;
  padding: 1.5rem;
  background: rgba(30, 41, 59, 0.98);
  border: 1px solid rgba(248, 113, 113, 0.35);
  border-radius: 0.75rem;
  color: var(--color-text);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
}

.confirm-title {
  margin: 0 0 0.75rem;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--color-danger-soft);
}

.confirm-text {
  margin: 0 0 1rem;
  font-size: 0.9rem;
  line-height: 1.55;
  color: var(--color-text-muted);
}

.confirm-label {
  display: block;
  margin-bottom: 0.4rem;
  font-size: 0.82rem;
  color: var(--color-text-subtle);
}

.confirm-input {
  width: 100%;
  padding: 0.5rem 0.65rem;
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid var(--color-border-stronger);
  border-radius: 0.375rem;
  color: #f1f5f9;
  font-size: 0.9rem;
}

.confirm-input:focus {
  outline: 2px solid var(--color-danger);
  outline-offset: 1px;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1.25rem;
}

.confirm-cancel,
.confirm-accept {
  padding: 0.5rem 0.9rem;
  border-radius: 0.375rem;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease;
}

.confirm-cancel {
  background: transparent;
  border: 1px solid var(--color-border-stronger);
  color: var(--color-text-muted);
}

.confirm-cancel:hover {
  background: rgba(148, 163, 184, 0.12);
  color: #f1f5f9;
}

.confirm-accept {
  background: #dc2626;
  border: none;
  color: #fff;
}

.confirm-accept:hover:not(:disabled) {
  background: #b91c1c;
}

.confirm-accept:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.confirm-danger-enter-active,
.confirm-danger-leave-active {
  transition: opacity 0.2s ease;
}

.confirm-danger-enter-from,
.confirm-danger-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .confirm-danger-enter-active,
  .confirm-danger-leave-active {
    transition: none;
  }
}
</style>
