<script setup lang="ts">
import { useGameT } from '../i18n'
import { useI18n } from 'vue-i18n'
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import type { GameProps } from '../types'
import type { KaboomSettings, KaboomState } from './types'
import { TEAM_COLORS, TEAM_KEYS, acknowledgeKaboom, answer, createGame, draw, finish, ranking, wordSticksInCup } from './logic'
import Cup from './Cup.vue'
import KaboomBlast from './KaboomBlast.vue'
import GameShell from '../shared/ui/GameShell.vue'
import ResultScreen from '../shared/ui/ResultScreen.vue'
import PromptCard from '../shared/answer/PromptCard.vue'
import AnswerInput from '../shared/answer/AnswerInput.vue'
import { buildChoices, makePrompt, type AnswerResult, type Prompt } from '../shared/answer/prompt'
import { useTimers } from '../shared/timing'

const props = defineProps<GameProps<KaboomSettings>>()
const gt = useGameT('kaboom')
const { t } = useI18n()
const { wait, cancelAll } = useTimers()

// --- setup -------------------------------------------------------------------
const stage = ref<'setup' | 'playing' | 'done'>('setup')
const teamCount = ref(2)
// Pre-filled with "Team Rot", "Équipe rouge", … in the game language; editable.
const defaultTeamName = (i: number) => gt(`teams.${TEAM_KEYS[i]}`)
const teamNames = ref<string[]>(TEAM_KEYS.map((_, i) => defaultTeamName(i)))

// --- game --------------------------------------------------------------------
const state = shallowRef<KaboomState>(createGame([{ name: '', color: '' }], props.vocabulary, props.settings))
const drawing = ref(false)
const prompt = shallowRef<Prompt | null>(null)
const choices = ref<string[] | undefined>()
const result = ref<AnswerResult | null>(null)
const promptKey = ref(0)

const secondsLeft = ref(0)
const timeUp = ref(false)
let clock: ReturnType<typeof setInterval> | undefined

const itemsById = computed(() => new Map(props.vocabulary.map((i) => [i.id, i])))
const currentTeam = computed(() => state.value.teams[state.value.current])
const inCup = computed(() => state.value.cup.length)
// Sticks only move between cup and teams, so this total is constant during a game.
const capacity = computed(
  () =>
    state.value.cup.length +
    state.value.teams.reduce((n, t) => n + t.sticks.length, 0) +
    (state.value.drawn ? 1 : 0),
)
const wordsLeft = computed(() => wordSticksInCup(state.value))
const timeLabel = computed(() => {
  const m = Math.floor(secondsLeft.value / 60)
  const s = secondsLeft.value % 60
  return `${m}:${String(s).padStart(2, '0')}`
})

function start() {
  cancelAll()
  stopClock()
  const teams = Array.from({ length: teamCount.value }, (_, i) => ({
    name: teamNames.value[i].trim() || defaultTeamName(i),
    color: TEAM_COLORS[i],
  }))
  state.value = createGame(teams, props.vocabulary, props.settings)
  prompt.value = null
  result.value = null
  drawing.value = false
  timeUp.value = false
  stage.value = 'playing'

  if (props.settings.timeLimit > 0) {
    secondsLeft.value = props.settings.timeLimit * 60
    clock = setInterval(() => {
      secondsLeft.value--
      if (secondsLeft.value <= 0) {
        stopClock()
        timeUp.value = true
        // Let a running question finish; otherwise end right away.
        if (state.value.phase === 'draw') endGame()
      }
    }, 1000)
  }
}

function restart() {
  cancelAll()
  stopClock()
  stage.value = 'setup'
}

function stopClock() {
  clearInterval(clock)
  clock = undefined
}
onBeforeUnmount(stopClock)

function endGame() {
  stopClock()
  state.value = finish(state.value)
  stage.value = 'done'
}

async function onDraw() {
  if (state.value.phase !== 'draw' || drawing.value) return
  drawing.value = true
  await wait(650)
  drawing.value = false
  state.value = draw(state.value)
  const stick = state.value.drawn
  if (stick?.kind === 'word') {
    const item = itemsById.value.get(stick.itemId)!
    const p = makePrompt(item, props.settings.direction)
    prompt.value = p
    choices.value = props.settings.answerModes.includes('choice') ? buildChoices(p, props.vocabulary, 4) : undefined
    result.value = null
    promptKey.value++
  }
}

async function onAnswer(r: AnswerResult) {
  result.value = r
  if (r.correct) {
    await wait(900)
    commit(true)
  }
}

function commit(correct: boolean) {
  prompt.value = null
  result.value = null
  state.value = answer(state.value, correct)
  afterTurn()
}

function continueAfterKaboom() {
  state.value = acknowledgeKaboom(state.value)
  afterTurn()
}

function afterTurn() {
  if (state.value.phase === 'finished' || timeUp.value) endGame()
}

const results = computed(() => ranking(state.value))
const winners = computed(() => results.value.filter((r) => r.rank === 1).map((r) => r.team.name))
</script>

<template>
  <GameShell :title="gt('name')" @restart="restart">
    <template #status>
      <template v-if="stage === 'playing'">
        <span v-if="settings.timeLimit > 0" class="clock" :class="{ low: secondsLeft <= 30 }">⏱ {{ timeLabel }}</span>
        <span class="left" :title="gt('wordSticks')">🥢 {{ wordsLeft }}</span>
      </template>
    </template>

    <!-- setup -->
    <div v-if="stage === 'setup'" class="setup card">
      <div class="setup-icon" aria-hidden="true">💥</div>
      <h2>{{ gt('name') }}</h2>
      <p class="muted">{{ gt('intro') }}</p>

      <label>{{ gt('howManyTeams') }}</label>
      <div class="count-picker">
        <button
          v-for="n in [2, 3, 4, 5, 6]"
          :key="n"
          type="button"
          class="count"
          :class="{ on: teamCount === n }"
          @click="teamCount = n"
        >
          {{ n }}
        </button>
      </div>

      <div class="names">
        <div v-for="i in teamCount" :key="i" class="name-row" :style="{ '--c': TEAM_COLORS[i - 1] }">
          <i />
          <input v-model="teamNames[i - 1]" class="input" maxlength="30" :aria-label="gt('teamNameLabel', { n: i })" />
        </div>
      </div>

      <button class="btn btn-primary btn-lg" type="button" @click="start">{{ gt('go') }}</button>
    </div>

    <!-- playing -->
    <div v-else-if="stage === 'playing'" class="play">
      <div class="teams">
        <div
          v-for="(t, i) in state.teams"
          :key="i"
          class="team"
          :class="{ active: i === state.current, boom: state.phase === 'kaboom' && i === state.current }"
          :style="{ '--c': t.color }"
        >
          <span class="team-name">{{ t.name }}</span>
          <span class="bundle" aria-hidden="true">
            <i v-for="k in Math.min(t.sticks.length, 12)" :key="k" />
          </span>
          <strong class="team-count">{{ t.sticks.length }}</strong>
        </div>
      </div>

      <div class="turn" :style="{ '--c': currentTeam.color }">
        <i class="turn-dot" />
        <span v-if="state.phase === 'draw'">{{ gt('teamDraws', { name: currentTeam.name }) }}</span>
        <span v-else-if="state.phase === 'answer'">{{ gt('teamTranslates', { name: currentTeam.name }) }}</span>
        <span v-else-if="state.phase === 'kaboom'">{{ gt('teamKaboom', { name: currentTeam.name }) }}</span>
      </div>

      <div class="stage">
        <Transition name="swap" mode="out-in">
          <!-- draw -->
          <div v-if="state.phase === 'draw'" key="draw" class="cup-area">
            <Cup :count="inCup" :capacity="capacity" :drawing="drawing" :disabled="drawing" @draw="onDraw" />
            <p class="muted small">{{ gt('inCup', { n: inCup }, inCup) }}</p>
          </div>

          <!-- word stick -->
          <div v-else-if="state.phase === 'answer' && prompt" :key="`q-${promptKey}`" class="question">
            <div class="stick-card">
              <PromptCard :prompt="prompt" />
            </div>
            <AnswerInput :prompt="prompt" :modes="settings.answerModes" :choices="choices" @answer="onAnswer" />
            <button v-if="result && !result.correct" class="btn btn-accent btn-lg" type="button" autofocus @click="commit(false)">
              {{ gt('putBack') }}
            </button>
          </div>

          <!-- KABOOM -->
          <div v-else-if="state.phase === 'kaboom'" key="boom" class="kaboom" role="alert">
            <KaboomBlast />
            <p class="boom-msg">
              <template v-if="state.lost > 0">{{ gt('teamLost', { name: currentTeam.name, n: state.lost }, state.lost) }}</template>
              <template v-else>{{ gt('teamLucky', { name: currentTeam.name }) }}</template>
            </p>
            <button class="btn btn-primary btn-lg" type="button" autofocus @click="continueAfterKaboom">{{ t('game.next') }}</button>
          </div>
        </Transition>
      </div>
    </div>

    <!-- done -->
    <ResultScreen
      v-else
      :title="winners.length === 1 ? gt('winsTrophy', { name: winners[0] }) : gt('tie', { names: winners.join(' & ') })"
      :subtitle="timeUp ? gt('timeUp') : gt('cupEmpty')"
      @again="start"
    >
      <ol class="ranking">
        <li v-for="r in results" :key="r.team.name" :style="{ '--c': r.team.color }">
          <span class="rank">{{ r.rank }}.</span>
          <i />
          <span class="rname">{{ r.team.name }}</span>
          <span class="muted small">{{ r.team.kabooms }}× 💥</span>
          <strong>{{ r.team.sticks.length }} 🥢</strong>
        </li>
      </ol>
    </ResultScreen>
  </GameShell>
</template>

<style scoped>
.setup {
  max-width: 460px;
  margin: 16px auto;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 28px 22px;
  box-shadow: var(--shadow);
}
.setup h2,
.setup p {
  margin: 0;
}
.setup-icon {
  font-size: 3rem;
  line-height: 1;
}
.count-picker {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
}
.count {
  padding: 10px 0;
  border: 2px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-bright);
  font: 800 1.2rem var(--font-display);
  color: var(--ink);
  cursor: pointer;
}
.count.on {
  border-color: var(--primary);
  background: var(--primary-soft);
}
.names {
  display: grid;
  gap: 8px;
}
.name-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.name-row i {
  flex: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--c);
}

.play {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.teams {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
}
.team {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 8px;
  border-radius: var(--radius);
  background: var(--surface);
  border: 2px solid var(--line);
  transition:
    transform 0.2s var(--ease-bounce),
    border-color 0.2s;
}
.team.active {
  border-color: var(--c);
  background: color-mix(in srgb, var(--c) 10%, var(--surface));
  transform: translateY(-2px);
}
.team.boom {
  animation: shake 0.5s ease;
}
.team-name {
  font-weight: 700;
  font-size: 0.9rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.bundle {
  display: flex;
  gap: 2px;
  height: 22px;
  align-items: flex-end;
}
.bundle i {
  width: 4px;
  height: 22px;
  border-radius: 2px;
  background: var(--c);
  opacity: 0.85;
  animation: pop-in 0.3s var(--ease-bounce);
}
.team-count {
  font: 800 1.4rem var(--font-display);
  line-height: 1;
}
.turn {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--c) 14%, var(--surface));
  border: 1.5px solid color-mix(in srgb, var(--c) 40%, transparent);
  font-weight: 700;
}
.turn-dot {
  flex: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--c);
}
.stage {
  min-height: 300px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.cup-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 0;
}
.small {
  font-size: 0.9rem;
  margin: 0;
}
.question {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 560px;
  width: 100%;
  margin: 0 auto;
}
.stick-card {
  animation: rise-in 0.4s var(--ease-bounce);
}
.stick-card :deep(.prompt) {
  border: 3px solid var(--table-edge);
  background: repeating-linear-gradient(90deg, var(--table-a), var(--table-a) 18px, var(--table-b) 18px, var(--table-b) 20px);
}

.kaboom {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
}
.boom-msg {
  font-size: 1.1rem;
  margin: 0;
}

.clock {
  font-variant-numeric: tabular-nums;
}
.clock.low {
  color: var(--bad);
}

.ranking {
  list-style: none;
  padding: 0;
  margin: 0 0 20px;
  text-align: left;
}
.ranking li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
}
.ranking i {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--c);
}
.rank {
  width: 22px;
  font-weight: 800;
}
.rname {
  flex: 1;
}

@keyframes shake {
  20%,
  60% {
    transform: translateX(-6px);
  }
  40%,
  80% {
    transform: translateX(6px);
  }
}
@keyframes rise-in {
  from {
    transform: translateY(40px) scale(0.9);
    opacity: 0;
  }
}
@keyframes pop-in {
  from {
    transform: scaleY(0);
  }
}
.swap-enter-active,
.swap-leave-active {
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}
.swap-enter-from {
  transform: scale(0.96);
  opacity: 0;
}
.swap-leave-to {
  opacity: 0;
}
</style>
