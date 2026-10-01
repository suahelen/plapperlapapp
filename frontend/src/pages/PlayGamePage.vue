<script setup lang="ts">
import { gameName } from '@/games/i18n'
import { useI18n } from 'vue-i18n'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { loadPublicActivity } from '@/stores/publicActivity'
import { ApiError, errorMessage } from '@/api/client'
import type { PublicActivity } from '@/models'
import { getGame } from '@/games/registry'
import { resolveSettings } from '@/games/settings'
import type { VocabularyItem } from '@/games/types'

const props = defineProps<{ publicId: string; gameId: string }>()
const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const activity = ref<PublicActivity | null>(null)
const error = ref('')

onMounted(async () => {
  try {
    activity.value = await loadPublicActivity(props.publicId)
  } catch (e) {
    error.value = e instanceof ApiError && e.status === 404 ? t('play.notFound') : errorMessage(e)
  }
})

const game = computed(() => {
  const a = activity.value
  if (!a) return null
  const def = getGame(props.gameId)
  const stored = a.games.find((g) => g.type === props.gameId)
  if (!def || !stored) return null
  return { def, settings: resolveSettings(def, stored.settings) }
})

// Games receive the activity's vocabulary in the normalised shape; they never own it.
const vocabulary = computed<VocabularyItem[]>(() => activity.value?.vocabulary ?? [])
const enoughWords = computed(() => !game.value?.def.minWords || vocabulary.value.length >= game.value.def.minWords)

/**
 * Single device or several devices. A room link (?room=) always means several devices;
 * games with only one mode skip the choice.
 */
const mode = computed<'single' | 'multi' | null>(() => {
  const def = game.value?.def
  if (!def) return null
  if (!def.multiplayer) return 'single'
  if (!def.component) return 'multi'
  if (route.query.room) return 'multi'
  const m = route.query.mode
  return m === 'single' || m === 'multi' ? m : null
})

const component = computed(() =>
  mode.value === 'multi' ? game.value?.def.multiplayer?.component : game.value?.def.component,
)

function choose(m: 'single' | 'multi') {
  router.replace({ query: { mode: m } })
}
</script>

<template>
  <div v-if="error || (activity && (!game || !enoughWords))" class="message card">
    <h1>{{ t('play.unavailable') }}</h1>
    <p class="muted">{{ error || (!game ? t('play.notEnabled') : t('play.tooFewWords')) }}</p>
    <RouterLink :to="`/play/${publicId}`" class="btn">← {{ t('play.toGames') }}</RouterLink>
  </div>
  <p v-else-if="!activity" class="muted loading">{{ t('common.loading') }}</p>

  <!-- mode picker -->
  <div v-else-if="game && mode === null" class="picker">
    <RouterLink :to="`/play/${publicId}`" class="btn btn-ghost back">← {{ t('play.games') }}</RouterLink>
    <div class="picker-head">
      <span class="picker-icon" aria-hidden="true">{{ game.def.icon }}</span>
      <h1>{{ gameName(game.def) }}</h1>
      <p class="muted">{{ t('play.howToPlay') }}</p>
    </div>
    <div class="options">
      <button type="button" class="option" :style="{ '--g': game.def.color }" @click="choose('single')">
        <span class="option-icon" aria-hidden="true">📱</span>
        <strong>{{ t('play.single') }}</strong>
        <small>{{ t('play.singleText') }}</small>
      </button>
      <button type="button" class="option" :style="{ '--g': game.def.color }" @click="choose('multi')">
        <span class="option-icon" aria-hidden="true">📱📱</span>
        <strong>{{ t('play.multi') }}</strong>
        <small>{{ t('play.multiText', { min: game.def.multiplayer!.minPlayers, max: game.def.multiplayer!.maxPlayers }) }}</small>
      </button>
    </div>
  </div>

  <component :is="component" v-else-if="game && component" :vocabulary="vocabulary" :settings="game.settings" />
</template>

<style scoped>
.message {
  max-width: 480px;
  margin: 48px auto;
  text-align: center;
}
.loading {
  text-align: center;
  padding-top: 64px;
}
.picker {
  max-width: 560px;
  margin: 0 auto;
  padding: max(16px, env(safe-area-inset-top)) 16px 48px;
}
.back {
  margin-bottom: 8px;
}
.picker-head {
  text-align: center;
  margin-bottom: 24px;
}
.picker-head h1 {
  margin-bottom: 4px;
}
.picker-icon {
  font-size: 3rem;
}
.options {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 14px;
}
.option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 24px 18px;
  border-radius: var(--radius-lg);
  border: 2px solid color-mix(in srgb, var(--g) 35%, var(--line));
  background: var(--surface);
  box-shadow: 0 4px 0 color-mix(in srgb, var(--g) 35%, var(--line));
  color: var(--ink);
  font: inherit;
  text-align: center;
  cursor: pointer;
  transition: transform 0.15s var(--ease-bounce);
}
.option:hover {
  transform: translateY(-2px);
}
.option:active {
  transform: translateY(3px);
}
.option-icon {
  font-size: 2rem;
}
.option strong {
  font-family: var(--font-display);
  font-size: 1.2rem;
}
.option small {
  color: var(--muted);
}
</style>
