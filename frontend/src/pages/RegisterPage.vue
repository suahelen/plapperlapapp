<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import AuthForm from '@/components/AuthForm.vue'
import { register } from '@/stores/session'
const { t } = useI18n()

const router = useRouter()

async function submit(email: string, password: string) {
  await register(email, password)
  router.push('/vocabulary/new')
}
</script>

<template>
  <AuthForm :title="t('auth.createAccount')" :submit-label="t('auth.register')" :min-password-length="8" :on-submit="submit">
    <p class="muted">{{ t('auth.haveAccount') }} <RouterLink to="/login">{{ t('auth.login') }}</RouterLink></p>
  </AuthForm>
</template>
