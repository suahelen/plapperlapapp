<script setup lang="ts">
import { gameDescription, gameName } from '@/games/i18n'
import { useI18n } from 'vue-i18n'
import { computed, onMounted, ref } from 'vue'
import { loadPublicActivity } from '@/stores/publicActivity'
import { ApiError, errorMessage } from '@/api/client'
import type { PublicActivity } from '@/models'
import { getGame } from '@/games/registry'

const props = defineProps<{ publicId: string }>()
const { t } = useI18n()

const activity = ref<PublicActivity | null>(null)
const error = ref('')
const notFound = ref(false)

onMounted(async () => {
  try {
    activity.value = await loadPublicActivity(props.publicId)
    document.title = `${activity.value.title} · ${t('app.name')}`
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound.value = true
    else error.value = errorMessage(e)
  }
})

// Only games this app version knows about are shown.
const games = computed(() =>
  (activity.value?.games ?? []).flatMap((g) => {
    const def = getGame(g.type)
    if (!def) return []
    const enough = !def.minWords || activity.value!.vocabulary.length >= def.minWords
    return [{ def, enough }]
  }),
)
</script>

<template>
  <main class="play-home">
    <div v-if="notFound" class="card message">
      <div class="big" aria-hidden="true">🔍</div>
      <h1>{{ t('play.notFound') }}</h1>
      <p class="muted">{{ t('play.checkLink') }}</p>
    </div>
    <div v-else-if="error" class="card message">
      <h1>{{ t('play.oops') }}</h1>
      <p class="alert">{{ error }}</p>
    </div>
    <p v-else-if="!activity" class="muted loading">{{ t('common.loading') }}</p>

    <template v-else>
      <header class="hero">
        <p class="kicker">{{ t('play.words', { n: activity.vocabulary.length }, activity.vocabulary.length) }}</p>
        <h1>{{ activity.title }}</h1>
        <p class="muted">{{ t('play.chooseGame') }}</p>
      </header>

      <div class="tiles">
        <component
          :is="enough ? 'RouterLink' : 'div'"
          v-for="{ def, enough } in games"
          :key="def.id"
          :to="enough ? `/play/${publicId}/${def.id}` : undefined"
          class="tile"
          :class="{ disabled: !enough }"
          :style="{ '--g': def.color }"
        >
          <span class="tile-icon" aria-hidden="true">{{ def.icon }}</span>
          <span class="tile-text">
            <strong>
              {{ gameName(def) }}
              <span v-if="def.multiplayer" class="mp">
                👥 {{ def.component ? t('play.alsoDevices', { n: def.multiplayer.maxPlayers }) : t('play.devices', { n: def.multiplayer.maxPlayers }) }}
              </span>
            </strong>
            <small>{{ enough ? gameDescription(def) : t('play.needsWords', { n: def.minWords }) }}</small>
          </span>
          <span class="tile-go" aria-hidden="true">→</span>
        </component>
      </div>
    </template>
  </main>
</template>

<style scoped>
.play-home {
  max-width: 640px;
  margin: 0 auto;
  padding: max(32px, env(safe-area-inset-top)) 16px 48px;
}
.hero {
  text-align: center;
  margin-bottom: 28px;
}
.hero h1 {
  font-size: clamp(2rem, 7vw, 2.8rem);
  margin-bottom: 4px;
}
.kicker {
  display: inline-block;
  margin: 0 0 10px;
  padding: 4px 12px;
  border-radius: 999px;
  background: var(--surface-2);
  font-weight: 700;
  font-size: 0.85rem;
  color: var(--muted);
}
.tiles {
  display: grid;
  gap: 14px;
}
.tile {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 20px;
  border-radius: var(--radius-lg);
  background: var(--surface);
  border: 2px solid color-mix(in srgb, var(--g) 35%, var(--line));
  box-shadow: 0 4px 0 color-mix(in srgb, var(--g) 35%, var(--line));
  color: var(--ink);
  text-decoration: none;
  transition:
    transform 0.15s var(--ease-bounce),
    box-shadow 0.15s ease;
}
.tile:not(.disabled):hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 0 color-mix(in srgb, var(--g) 45%, var(--line));
}
.tile:not(.disabled):active {
  transform: translateY(3px);
  box-shadow: 0 1px 0 color-mix(in srgb, var(--g) 45%, var(--line));
}
.tile.disabled {
  opacity: 0.55;
}
.tile-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  border-radius: 18px;
  background: color-mix(in srgb, var(--g) 16%, var(--surface-bright));
  font-size: 2.2rem;
}
.tile-text {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.tile-text strong {
  font-family: var(--font-display);
  font-size: 1.35rem;
}
.mp {
  display: inline-block;
  vertical-align: middle;
  margin-left: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--g) 15%, var(--surface-bright));
  color: var(--g);
  font: 700 0.75rem var(--font);
}
.tile-text small {
  color: var(--muted);
  font-size: 0.92rem;
}
.tile-go {
  font-size: 1.4rem;
  color: var(--g);
  font-weight: 800;
}
.message {
  text-align: center;
  padding: 40px 20px;
}
.big {
  font-size: 3rem;
}
.loading {
  text-align: center;
  padding-top: 64px;
}
</style>
