<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import AuthForm from '@/components/AuthForm.vue'
import { login } from '@/stores/session'
const { t } = useI18n()

const route = useRoute()
const router = useRouter()

async function submit(email: string, password: string) {
  await login(email, password)
  const next = typeof route.query.next === 'string' && route.query.next.startsWith('/') && !route.query.next.startsWith('//') ? route.query.next : '/activities'
  router.push(next)
}
</script>

<template>
  <AuthForm :title="t('auth.login')" :submit-label="t('auth.login')" :on-submit="submit">
    <p class="muted">{{ t('auth.noAccount') }} <RouterLink to="/register">{{ t('auth.register') }}</RouterLink></p>
  </AuthForm>
</template>
