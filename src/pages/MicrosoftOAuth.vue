<script setup lang="ts">
import { onMounted, ref } from 'vue'

const authUrl = ref('')

onMounted(() => {
  const hash = window.location.hash || ''
  const query = hash.includes('?') ? hash.split('?')[1] : ''
  const params = new URLSearchParams(query)
  authUrl.value = params.get('url') || ''
  if (authUrl.value) {
    window.location.replace(authUrl.value)
  }
})
</script>

<template>
  <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:Arial,sans-serif;">
    <div>
      <h2>Opening Microsoft sign-in…</h2>
      <p v-if="authUrl">If you are not redirected automatically, <a :href="authUrl">click here</a>.</p>
    </div>
  </div>
</template>
