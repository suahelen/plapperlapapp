<script setup lang="ts">
import { learnedLocale } from '@/i18n/gameLocale'
import { LOCALE_NAMES, SUPPORTED } from '@/i18n'
import { gameDescription, gameName } from '@/games/i18n'
import { useI18n } from 'vue-i18n'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { copyActivity, createActivity, getActivity, publicUrl, updateActivity } from '@/api/activities'
import { getSet, listSets } from '@/api/vocabulary'
import { errorMessage } from '@/api/client'
import type { Activity, ActivityInput, Role, VocabularySet, WordFilter } from '@/models'
import { cleanFilter, fieldValues, matchesFilter } from '@/lib/wordFilter'
import ShareDialog from '@/components/ShareDialog.vue'
import { listGames } from '@/games/registry'
import { resolveSettings, validateSettings } from '@/games/settings'
import type { GameSettings } from '@/games/types'
import GameSettingsPanel from '@/components/GameSettingsPanel.vue'
import QrCode from '@/components/QrCode.vue'

const props = defineProps<{ id?: string }>()
const { t } = useI18n()
const router = useRouter()

const games = listGames()

const sets = ref<VocabularySet[]>([])
const activity = ref<Activity | null>(null)
const title = ref('')
const published = ref(false)
const selectedSets = ref<string[]>([])
// '' = automatic: the language being learned, derived from the selected word lists.
const gameLanguage = ref('')
const gameState = reactive<Record<string, { enabled: boolean; settings: GameSettings }>>(
  Object.fromEntries(games.map((g, i) => [g.id, { enabled: i === 0, settings: { ...g.defaultSettings } }])),
)

const loading = ref(true)
const saving = ref(false)
const error = ref('')
const savedAt = ref<Date | null>(null)
const copied = ref(false)
const presenting = ref(false)

async function load(id: string | undefined) {
  loading.value = true
  error.value = ''
  try {
    const [allSets, existing] = await Promise.all([listSets(), id ? getActivity(id) : null])
    sets.value = allSets
    if (existing) applyActivity(existing)
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}
onMounted(() => load(props.id))
// The same page shows the copy after "Kopie erstellen".
watch(
  () => props.id,
  (id) => {
    showShare.value = false
    void load(id)
  },
)

function applyActivity(a: Activity) {
  activity.value = a
  title.value = a.title
  published.value = a.published
  selectedSets.value = [...a.vocabularySetIds]
  for (const key of Object.keys(filters)) delete filters[key]
  for (const ref of a.vocabularySets ?? []) filters[ref.id] = { ...ref.filter }
  gameLanguage.value = a.gameLanguage ?? ''
  for (const g of games) {
    const stored = a.games.find((x) => x.type === g.id)
    gameState[g.id] = { enabled: !!stored, settings: resolveSettings(g, stored?.settings) }
  }
}

// --- sharing ----------------------------------------------------------------
const role = computed<Role>(() => activity.value?.role ?? 'owner')
const readOnly = computed(() => role.value === 'viewer')
const showShare = ref(false)
const copying = ref(false)

async function copy() {
  if (!props.id) return
  copying.value = true
  try {
    const created = await copyActivity(props.id, t('common.copySuffix'))
    router.push(`/activities/${created.id}`)
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    copying.value = false
  }
}

const mySets = computed(() => sets.value.filter((s) => s.role === 'owner'))
const sharedSets = computed(() => sets.value.filter((s) => s.role !== 'owner'))
/** Lists the activity uses that this teacher can't see (an editor working on a colleague's activity). */
const hiddenSets = computed(() => selectedSets.value.filter((id) => !sets.value.some((s) => s.id === id)))

// --- choosing words by extra columns (unit, page, …) ---------------------------
const filters = reactive<Record<string, WordFilter>>({})
// Full lists (with items) of the selected lists, for column values and live word counts.
const details = reactive<Record<string, VocabularySet>>({})

watch(
  selectedSets,
  (ids) => {
    for (const id of ids) {
      if (details[id] || !sets.value.some((s) => s.id === id)) continue
      getSet(id)
        .then((s) => (details[id] = s))
        .catch(() => undefined) // the list still counts with its total
    }
  },
  { immediate: true },
)

const columnsOf = (id: string) => (details[id] ? fieldValues(details[id].items ?? []) : {})
const hasColumns = (id: string) => Object.keys(columnsOf(id)).length > 0

function wordsIn(id: string): number {
  const d = details[id]
  if (d?.items) return d.items.filter((i) => matchesFilter(i.metadata, filters[id])).length
  return sets.value.find((s) => s.id === id)?.itemCount ?? 0
}

const isPicked = (id: string, field: string, value: string) => !!filters[id]?.[field]?.includes(value)
function togglePick(id: string, field: string, value: string) {
  const current = filters[id]?.[field] ?? []
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
  filters[id] = cleanFilter({ ...(filters[id] ?? {}), [field]: next })
}

const wordCount = computed(() => selectedSets.value.reduce((n, id) => n + wordsIn(id), 0))
const enabledGames = computed(() => games.filter((g) => gameState[g.id].enabled))
const autoLocale = computed(() => learnedLocale(sets.value.filter((s) => selectedSets.value.includes(s.id))) ?? 'de')
const shareUrl = computed(() => (activity.value ? publicUrl(activity.value.publicId) : ''))

function validate(): string | null {
  if (!title.value.trim()) return t('activity.needTitle')
  if (selectedSets.value.length === 0) return t('activity.needSet')
  if (enabledGames.value.length === 0) return t('activity.needGame')
  for (const g of enabledGames.value) {
    const problems = validateSettings(g, gameState[g.id].settings)
    if (problems.length) return problems[0]
  }
  return null
}

async function save(publish?: boolean) {
  error.value = ''
  const problem = validate()
  if (problem) {
    error.value = problem
    return
  }
  const input: ActivityInput = {
    title: title.value,
    published: publish ?? published.value,
    vocabularySets: selectedSets.value.map((id) => ({ id, filter: cleanFilter(filters[id] ?? {}) })),
    gameLanguage: gameLanguage.value,
    games: enabledGames.value.map((g) => ({ type: g.id, settings: gameState[g.id].settings })),
  }
  saving.value = true
  try {
    const saved = props.id ? await updateActivity(props.id, input) : await createActivity(input)
    applyActivity(saved)
    savedAt.value = new Date()
    if (!props.id) router.replace(`/activities/${saved.id}`)
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    saving.value = false
  }
}

async function copyUrl() {
  try {
    await navigator.clipboard.writeText(shareUrl.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    // Clipboard may be unavailable (e.g. plain HTTP); the URL is still selectable.
  }
}
</script>

<template>
  <main class="container stack">
    <div class="row">
      <RouterLink to="/activities" class="btn btn-ghost">← {{ t('nav.activities') }}</RouterLink>
      <div class="spacer" />
      <template v-if="id && activity && !loading">
        <button class="btn" type="button" :disabled="copying" @click="copy">⧉ {{ t('share.makeCopy') }}</button>
        <button v-if="role === 'owner'" class="btn" type="button" @click="showShare = !showShare">👥 {{ t('share.button') }}</button>
      </template>
    </div>

    <p v-if="loading" class="muted">{{ t('common.loading') }}</p>
    <template v-else>
      <div v-if="role === 'viewer'" class="notice" role="status">
        👁 {{ t('share.viewOnly', { email: activity?.ownerEmail }) }}
        <button class="btn btn-primary" type="button" :disabled="copying" @click="copy">{{ t('share.makeCopy') }}</button>
      </div>
      <div v-else-if="role === 'editor'" class="notice" role="status">✏️ {{ t('share.canEdit', { email: activity?.ownerEmail }) }}</div>

      <ShareDialog v-if="showShare && id" target="activities" :id="id" @close="showShare = false" />
      <!-- share panel -->
      <section v-if="activity?.published" class="card share">
        <div class="share-text stack">
          <div>
            <span class="badge badge-good">{{ t('activity.published') }}</span>
            <h2 style="margin: 8px 0 4px">{{ t('activity.share') }}</h2>
            <p class="muted" style="margin: 0">{{ t('activity.noAccountNeeded') }}</p>
          </div>
          <div class="url-row">
            <input class="input url" :value="shareUrl" readonly @focus="($event.target as HTMLInputElement).select()" />
            <button class="btn btn-accent" type="button" @click="copyUrl">{{ copied ? t('activity.copied') : t('activity.copy') }}</button>
          </div>
          <div class="row">
            <button class="btn" type="button" @click="presenting = true">{{ t('activity.showQr') }}</button>
            <a :href="shareUrl" target="_blank" class="btn btn-ghost">{{ t('activity.testAsStudent') }} ↗</a>
          </div>
        </div>
        <QrCode :value="shareUrl" :size="180" class="share-qr" />
      </section>

      <fieldset class="plain stack" :disabled="readOnly">
      <section class="card stack">
        <div class="field">
          <label for="title">{{ t('common.title') }}</label>
          <input id="title" v-model="title" class="input title-input" :placeholder="t('activity.titlePlaceholder')" maxlength="200" />
        </div>
      </section>

      <section class="card stack">
        <div class="row">
          <h2 style="margin: 0">{{ t('activity.wordLists') }}</h2>
          <span v-if="selectedSets.length" class="badge">{{ t('play.words', { n: wordCount }, wordCount) }}</span>
        </div>
        <p v-if="sets.length === 0" class="muted" style="margin: 0">
          {{ t('activity.noSets') }} <RouterLink to="/vocabulary/new">{{ t('activity.createSet') }}</RouterLink>
        </p>
        <template v-for="group in [{ key: 'mine', list: mySets }, { key: 'shared', list: sharedSets }]" :key="group.key">
          <h3 v-if="group.list.length && sharedSets.length" class="group-title">
            {{ group.key === 'mine' ? t('share.mine') : t('share.sharedWithMe') }}
          </h3>
          <div v-if="group.list.length" class="set-grid">
            <div v-for="s in group.list" :key="s.id" class="set-option" :class="{ on: selectedSets.includes(s.id) }">
              <label class="set-head">
                <input v-model="selectedSets" type="checkbox" :value="s.id" />
                <span>
                  <strong>{{ s.title }}</strong>
                  <small class="muted">
                    <template v-if="selectedSets.includes(s.id) && wordsIn(s.id) !== s.itemCount">
                      {{ t('activity.wordsOf', { n: wordsIn(s.id), total: s.itemCount }) }}
                    </template>
                    <template v-else>{{ t('play.words', { n: s.itemCount }, s.itemCount) }}</template>
                    <template v-if="s.role !== 'owner'"> · {{ s.ownerEmail }}</template>
                  </small>
                </span>
              </label>
              <!-- choose words by unit, page, … -->
              <div v-if="selectedSets.includes(s.id) && hasColumns(s.id)" class="columns">
                <div v-for="(values, field) in columnsOf(s.id)" :key="field" class="column">
                  <span class="column-name">{{ field }}:</span>
                  <button
                    v-for="v in values"
                    :key="v.value"
                    type="button"
                    class="pick"
                    :class="{ on: isPicked(s.id, field, v.value) }"
                    :aria-pressed="isPicked(s.id, field, v.value)"
                    :title="t('play.words', { n: v.count }, v.count)"
                    @click="togglePick(s.id, field, v.value)"
                  >
                    {{ v.value }}
                  </button>
                </div>
                <small class="muted">{{ t('activity.filterHelp') }}</small>
              </div>
            </div>
          </div>
        </template>
        <p v-if="hiddenSets.length" class="muted" style="margin: 0">
          {{ t('activity.hiddenSets', { n: hiddenSets.length }, hiddenSets.length) }}
        </p>
      </section>

      <section class="card stack">
        <div class="field">
          <label for="game-language">{{ t('activity.gameLanguage') }}</label>
          <select id="game-language" v-model="gameLanguage">
            <option value="">{{ t('activity.gameLanguageAuto', { language: LOCALE_NAMES[autoLocale] }) }}</option>
            <option v-for="l in SUPPORTED" :key="l" :value="l">{{ LOCALE_NAMES[l] }}</option>
          </select>
          <small class="muted">{{ t('activity.gameLanguageHint') }}</small>
        </div>
      </section>

      <section class="card stack">
        <h2 style="margin: 0">{{ t('activity.games') }}</h2>
        <div v-for="g in games" :key="g.id" class="game" :class="{ on: gameState[g.id].enabled }" :style="{ '--g': g.color }">
          <label class="game-head">
            <input v-model="gameState[g.id].enabled" type="checkbox" />
            <span class="game-icon" aria-hidden="true">{{ g.icon }}</span>
            <span class="game-text">
              <strong>{{ gameName(g) }}</strong>
              <small class="muted">{{ gameDescription(g) }}</small>
            </span>
          </label>
          <div v-if="gameState[g.id].enabled" class="game-settings">
            <p v-if="g.minWords && selectedSets.length && wordCount < g.minWords" class="alert" style="margin: 0 0 12px">
              {{ t('activity.needsWords', { n: g.minWords }) }}
            </p>
            <GameSettingsPanel v-model="gameState[g.id].settings" :game="g" />
          </div>
        </div>
      </section>

      </fieldset>

      <div v-if="readOnly && error" class="alert" role="alert">{{ error }}</div>
      <div v-if="!readOnly" class="save-bar">
        <div v-if="error" class="alert" role="alert">{{ error }}</div>
        <div class="row">
          <button v-if="!activity?.published" class="btn btn-primary btn-lg" type="button" :disabled="saving" @click="save(true)">
            {{ t('activity.publish') }}
          </button>
          <button class="btn btn-lg" :class="{ 'btn-primary': activity?.published }" type="button" :disabled="saving" @click="save()">
            {{ activity?.published ? t('common.save') : t('activity.saveDraft') }}
          </button>
          <span v-if="savedAt && !error && !saving" class="saved">{{ t('common.saved') }}</span>
          <div class="spacer" />
          <button v-if="activity?.published" class="btn btn-ghost" type="button" :disabled="saving" @click="save(false)">
            {{ t('activity.unpublish') }}
          </button>
        </div>
      </div>
    </template>

    <!-- presentation overlay for the projector -->
    <Teleport to="body">
      <div v-if="presenting && activity" class="present" role="dialog" aria-modal="true" @click.self="presenting = false" @keydown.esc="presenting = false">
        <div class="present-card">
          <h1>{{ activity.title }}</h1>
          <QrCode :value="shareUrl" :size="520" />
          <p class="present-url">{{ shareUrl }}</p>
          <button class="btn btn-lg" type="button" autofocus @click="presenting = false">{{ t('common.close') }}</button>
        </div>
      </div>
    </Teleport>
  </main>
</template>

<style scoped>
.title-input {
  font-size: 1.2rem;
  font-weight: 700;
}
.share {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  align-items: center;
  border-color: var(--good);
  background: linear-gradient(135deg, var(--surface), var(--good-soft));
}
.share-text {
  flex: 1;
  min-width: 260px;
}
.share-qr {
  background: var(--surface-bright);
  padding: 8px;
  box-shadow: var(--shadow-sm);
}
.url-row {
  display: flex;
  gap: 8px;
}
.url {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 0.95rem;
}
.set-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
}
.set-option {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 12px 14px;
  border: 1.5px solid var(--line);
  border-radius: var(--radius-sm);
  font-weight: 400;
}
.set-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  cursor: pointer;
  font-weight: 400;
}
.set-head span {
  display: flex;
  flex-direction: column;
}
.group-title {
  margin: 4px 0 0;
  font-size: 0.95rem;
  color: var(--muted);
}
.columns {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px dashed color-mix(in srgb, var(--accent) 40%, transparent);
}
.column {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
.column-name {
  font-weight: 700;
  font-size: 0.85rem;
  margin-right: 4px;
}
.pick {
  min-width: 32px;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1.5px solid var(--line);
  background: var(--surface-bright);
  color: var(--ink);
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}
.pick.on {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-color);
}
.set-option.on {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.set-option input,
.game-head input {
  width: 20px;
  height: 20px;
  accent-color: var(--accent);
  flex: none;
}
.game {
  border: 1.5px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
}
.game.on {
  border-color: var(--g);
}
.game-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0;
  padding: 14px 16px;
  cursor: pointer;
  font-weight: 400;
}
.game.on .game-head {
  background: color-mix(in srgb, var(--g) 10%, var(--surface));
}
.game-icon {
  font-size: 1.8rem;
}
.game-text {
  display: flex;
  flex-direction: column;
}
.game-text strong {
  font-family: var(--font-display);
  font-size: 1.1rem;
}
.game-settings {
  padding: 16px;
  border-top: 1px solid var(--line);
}
.save-bar {
  position: sticky;
  bottom: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 0 max(12px, env(safe-area-inset-bottom));
  background: linear-gradient(transparent, var(--bg) 30%);
}
.saved {
  color: var(--good);
  font-weight: 700;
}
.present {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: var(--overlay);
  backdrop-filter: blur(4px);
}
.present-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  max-height: 100%;
  overflow: auto;
  padding: 32px;
  background: var(--surface-bright);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  text-align: center;
}
.present-card :deep(.qr) {
  width: min(520px, 70vh, 80vw) !important;
}
.present-url {
  font: 700 clamp(1rem, 2.5vw, 1.6rem) ui-monospace, Consolas, monospace;
  margin: 0;
  word-break: break-all;
}
</style>
