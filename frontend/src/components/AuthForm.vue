<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ref } from 'vue'
import { errorMessage } from '@/api/client'

const props = defineProps<{
  title: string
  submitLabel: string
  minPasswordLength?: number
  onSubmit: (email: string, password: string) => Promise<void>
}>()
const { t } = useI18n()

const email = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)

async function submit() {
  error.value = ''
  if (!email.value.includes('@')) {
    error.value = t('auth.invalidEmail')
    return
  }
  if (props.minPasswordLength && password.value.length < props.minPasswordLength) {
    error.value = t('auth.passwordTooShort', { n: props.minPasswordLength })
    return
  }
  busy.value = true
  try {
    await props.onSubmit(email.value.trim(), password.value)
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="container auth">
    <form class="card stack" @submit.prevent="submit">
      <h1>{{ title }}</h1>
      <div v-if="error" class="alert" role="alert">{{ error }}</div>
      <div class="field">
        <label for="email">{{ t('auth.email') }}</label>
        <input id="email" v-model="email" class="input" type="email" autocomplete="email" required />
      </div>
      <div class="field">
        <label for="password">{{ t('auth.password') }}</label>
        <input
          id="password"
          v-model="password"
          class="input"
          type="password"
          :autocomplete="minPasswordLength ? 'new-password' : 'current-password'"
          required
        />
      </div>
      <button class="btn btn-primary btn-lg" type="submit" :disabled="busy">{{ submitLabel }}</button>
      <slot />
    </form>
  </main>
</template>

<style scoped>
.auth {
  max-width: 420px;
  padding-top: 48px;
}
.auth .card {
  padding: 28px;
  box-shadow: var(--shadow);
}
</style>
