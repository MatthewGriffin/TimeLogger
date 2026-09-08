<script setup lang="ts">
import { onMounted, ref } from 'vue'

const authUrl = ref('')
const error = ref('')

// The sign-in URL arrives in the window hash, which anything that can open a
// window controls. Without this check the value would be both navigated to and
// rendered as a link target, making it an open redirect and a javascript: XSS
// vector. Microsoft is the only party we ever hand a sign-in flow to.
const MICROSOFT_LOGIN_HOSTS = ['login.microsoftonline.com', 'login.microsoft.com']

const asMicrosoftSignInUrl = (value: string | null): string => {
  if (!value) return ''
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return ''
    if (!MICROSOFT_LOGIN_HOSTS.includes(url.hostname.toLowerCase())) return ''
    return url.toString()
  } catch {
    return ''
  }
}

onMounted(() => {
  const hash = window.location.hash || ''
  const query = hash.includes('?') ? hash.split('?')[1] : ''
  const params = new URLSearchParams(query)
  authUrl.value = asMicrosoftSignInUrl(params.get('url'))

  if (authUrl.value) {
    window.location.replace(authUrl.value)
  } else {
    error.value = 'That sign-in link is not a valid Microsoft address, so it was not opened.'
  }
})
</script>

<template>
  <div class="oauth-page">
    <div>
      <h1>{{ error ? 'Sign-in blocked' : 'Opening Microsoft sign-in…' }}</h1>
      <p v-if="authUrl">If you are not redirected automatically, <a :href="authUrl">click here</a>.</p>
      <p v-else-if="error">{{ error }}</p>
    </div>
  </div>
</template>

<style scoped>
.oauth-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  padding: var(--page-gutter);
  text-align: center;
  font-family: var(--font-sans);
  color: var(--color-text);
}

.oauth-page h1 {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0 0 var(--space-sm);
}

.oauth-page p {
  margin: 0;
  font-size: 0.875rem;
  color: var(--color-text-subtle);
}
</style>
