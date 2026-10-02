<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { currentUser, logout } from '@/stores/session'
import { setTeacherLocale, teacherLocale } from '@/stores/locale'
import { LOCALE_NAMES, SUPPORTED, isLocale } from '@/i18n'
import GithubLink from './GithubLink.vue'

const router = useRouter()
const { t } = useI18n()

async function onLogout() {
  await logout()
  router.push('/login')
}

function onLanguage(e: Event) {
  const value = (e.target as HTMLSelectElement).value
  if (isLocale(value)) setTeacherLocale(value)
}
</script>

<template>
  <header class="header">
    <div class="inner">
      <RouterLink to="/" class="brand">
        <span class="logo" aria-hidden="true">
          <svg viewBox="0 0 64 64"><rect x="6" y="6" width="52" height="52" rx="14" fill="currentColor" /><circle cx="22" cy="22" r="5" fill="var(--on-color)" /><circle cx="42" cy="42" r="5" fill="var(--on-color)" /><circle cx="42" cy="22" r="5" fill="var(--on-color)" /><circle cx="22" cy="42" r="5" fill="var(--on-color)" /></svg>
        </span>
        {{ t('app.name') }}
      </RouterLink>
      <nav v-if="currentUser" class="nav">
        <RouterLink to="/activities">{{ t('nav.activities') }}</RouterLink>
        <RouterLink to="/vocabulary">{{ t('nav.vocabulary') }}</RouterLink>
      </nav>
      <div class="spacer" />
      <GithubLink />
      <label class="lang">
        <span aria-hidden="true">🌐</span>
        <span class="sr-only">{{ t('nav.language') }}</span>
        <select :value="teacherLocale" @change="onLanguage">
          <option v-for="l in SUPPORTED" :key="l" :value="l">{{ LOCALE_NAMES[l] }}</option>
        </select>
      </label>
      <template v-if="currentUser">
        <span class="email muted">{{ currentUser.email }}</span>
        <button class="btn btn-ghost" type="button" @click="onLogout">{{ t('nav.logout') }}</button>
      </template>
    </div>
  </header>
</template>
<style scoped>
.header {
  background: var(--surface);
  border-bottom: 1px solid var(--line);
}
.inner {
  max-width: 960px;
  margin: 0 auto;
  padding: 10px 16px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 20px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font: 800 1.25rem var(--font-display);
  color: var(--ink);
  text-decoration: none;
}
.logo {
  width: 32px;
  height: 32px;
  color: var(--primary);
}
.nav {
  display: flex;
  gap: 4px;
}
.nav a {
  padding: 8px 12px;
  border-radius: 999px;
  color: var(--muted);
  font-weight: 600;
  text-decoration: none;
}
.nav a:hover {
  background: var(--surface-2);
}
.nav a.router-link-active {
  color: var(--ink);
  background: var(--surface-2);
}
.lang {
  display: flex;
  align-items: center;
  gap: 4px;
}
.lang select {
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink);
  padding: 4px 10px;
  font: inherit;
  font-size: 0.9rem;
}
.email {
  font-size: 0.9rem;
}
@media (max-width: 600px) {
  .email {
    display: none;
  }
}
</style>
