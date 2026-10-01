<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed } from 'vue'
import { useRoute } from 'vue-router'

// Common frame for every game: back link, title, status area and restart button.
defineProps<{ title: string }>()
const emit = defineEmits<{ restart: [] }>()

const route = useRoute()
const backTo = computed(() => `/play/${route.params.publicId}`)
const { t } = useI18n()
</script>
<template>
  <div class="shell">
    <header class="bar">
      <RouterLink :to="backTo" class="btn btn-ghost btn-icon" :aria-label="t('game.back')">←</RouterLink>
      <h1 class="title">{{ title }}</h1>
      <div class="status"><slot name="status" /></div>
      <button class="btn btn-ghost btn-icon" type="button" :aria-label="t('game.restart')" :title="t('game.restart')" @click="emit('restart')">
        ↻
      </button>
    </header>
    <main class="body">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.shell {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
}
.bar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  padding-top: max(8px, env(safe-area-inset-top));
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--line);
}
.bar .btn-icon {
  font-size: 1.3rem;
}
.title {
  font-size: 1.15rem;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.status {
  flex: 1;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  font-weight: 700;
}
.body {
  flex: 1;
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
  padding: 16px;
}
</style>
