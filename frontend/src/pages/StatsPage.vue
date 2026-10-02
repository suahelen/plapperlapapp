<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed, onMounted, ref } from 'vue'
import { getStats, type Totals } from '@/api/stats'
import { errorMessage } from '@/api/client'
import { gameName } from '@/games/i18n'
import { listGames } from '@/games/registry'
import GithubLink from '@/components/GithubLink.vue'

const { t } = useI18n()
const totals = ref<Totals | null>(null)
const loading = ref(true)
const error = ref('')

onMounted(async () => {
  try {
    totals.value = await getStats()
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
})

const byGame = computed(() =>
  listGames()
    .map((def) => ({ def, count: totals.value?.byGame[def.id] ?? 0 }))
    .sort((a, b) => b.count - a.count),
)
</script>

<template>
  <div class="stats-page">
    <div class="head">
      <h1>{{ t('stats.title') }}</h1>
      <GithubLink />
    </div>
    <p v-if="loading" class="muted">{{ t('common.loading') }}</p>
    <p v-else-if="error" class="muted">{{ error }}</p>
    <template v-else-if="totals">
      <div class="totals">
        <div class="stat card">
          <strong>{{ totals.users }}</strong>
          <span>{{ t('stats.users') }}</span>
        </div>
        <div class="stat card">
          <strong>{{ totals.words }}</strong>
          <span>{{ t('stats.words') }}</span>
        </div>
        <div class="stat card">
          <strong>{{ totals.totalPlays }}</strong>
          <span>{{ t('stats.totalPlays') }}</span>
        </div>
      </div>

      <h2>{{ t('stats.byGame') }}</h2>
      <ul class="by-game">
        <li v-for="g in byGame" :key="g.def.id">
          <span class="icon" aria-hidden="true">{{ g.def.icon }}</span>
          <span class="name">{{ gameName(g.def) }}</span>
          <span class="count">{{ g.count }}</span>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.stats-page {
  max-width: 640px;
  margin: 0 auto;
  padding: 24px 16px 48px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.head h1 {
  margin: 0;
}
.totals {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
  margin: 20px 0 32px;
}
.stat {
  padding: 20px;
  text-align: center;
}
.stat strong {
  display: block;
  font-size: 2rem;
  font-family: var(--font-display);
}
.stat span {
  color: var(--muted);
}
.by-game {
  list-style: none;
  margin: 0;
  padding: 0;
}
.by-game li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
}
.by-game .icon {
  font-size: 1.3rem;
}
.by-game .name {
  flex: 1;
  font-weight: 600;
}
.by-game .count {
  color: var(--muted);
}
</style>
