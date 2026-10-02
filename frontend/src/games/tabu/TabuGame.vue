<script setup lang="ts">
import { useGameT } from '../i18n'
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import type { GameProps } from '../types'
import type { TabuSettings } from './types'
import {
  createGame,
  isLastTurn,
  makeTabuWord,
  markCorrect,
  markSkip,
  nextPlayer,
  showWord,
  startTurn,
  tick,
  winner,
} from './logic'
import GameShell from '../shared/ui/GameShell.vue'
import ResultScreen from '../shared/ui/ResultScreen.vue'
import { WordQueue } from '../shared/wordQueue'

const props = defineProps<GameProps<TabuSettings>>()
const gt = useGameT('tabu')

type Stage = 'setup' | 'ready' | 'describing' | 'turnOver' | 'finished'
const stage = ref<Stage>('setup')
const names = ref<string[]>([])
const nameInput = ref('')
const state = shallowRef(createGame([]))
let queue = new WordQueue(props.vocabulary)
let timer: ReturnType<typeof setInterval> | null = null

function addName() {
  const n = nameInput.value.trim()
  if (!n) return
  names.value.push(n)
  nameInput.value = ''
}
function removeName(i: number) {
  names.value.splice(i, 1)
}

function start() {
  stopTicking()
  queue = new WordQueue(props.vocabulary)
  state.value = createGame(names.value)
  stage.value = 'ready'
}

function restart() {
  stopTicking()
  stage.value = 'setup'
}

function playAgain() {
  stopTicking()
  queue = new WordQueue(props.vocabulary)
  state.value = createGame(state.value.players)
  stage.value = 'ready'
}

function beginTurn() {
  const word = makeTabuWord(queue.next())
  state.value = startTurn(state.value, word, props.settings.roundSeconds)
  stage.value = 'describing'
  startTicking()
}

function startTicking() {
  stopTicking()
  timer = setInterval(() => {
    state.value = tick(state.value)
    if (state.value.secondsLeft <= 0) {
      stopTicking()
      stage.value = 'turnOver'
    }
  }, 1000)
}
function stopTicking() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
onBeforeUnmount(stopTicking)

function correct() {
  if (stage.value !== 'describing' || !state.value.word) return
  state.value = markCorrect(state.value)
  state.value = showWord(state.value, makeTabuWord(queue.next()))
}
function skip() {
  if (stage.value !== 'describing' || !state.value.word) return
  queue.retryLater(state.value.word.item)
  state.value = markSkip(state.value)
  state.value = showWord(state.value, makeTabuWord(queue.next()))
}

function afterTurn() {
  if (isLastTurn(state.value)) {
    stage.value = 'finished'
  } else {
    state.value = nextPlayer(state.value)
    stage.value = 'ready'
  }
}

const top = computed(() => winner(state.value))
const ranked = computed(() =>
  state.value.players
    .map((name, i) => ({ name, score: state.value.scores[i] }))
    .sort((a, b) => b.score - a.score),
)
</script>

<template>
  <GameShell :title="gt('name')" @restart="restart">
    <template #status>
      <span v-if="stage === 'describing'">⏱ {{ state.secondsLeft }}s</span>
    </template>

    <div v-if="stage === 'setup'" class="card setup">
      <h2>{{ gt('name') }}</h2>
      <p class="muted">{{ gt('setup.intro') }}</p>
      <form class="add-form" @submit.prevent="addName">
        <div class="field">
          <input v-model="nameInput" class="input" :placeholder="gt('setup.namePlaceholder')" maxlength="20" />
        </div>
        <button class="btn btn-primary" type="submit">{{ gt('setup.add') }}</button>
      </form>
      <ul v-if="names.length" class="names">
        <li v-for="(n, i) in names" :key="i">
          <span>{{ n }}</span>
          <button type="button" class="remove" :aria-label="gt('setup.remove', { name: n })" @click="removeName(i)">×</button>
        </li>
      </ul>
      <p v-if="names.length < 2" class="muted small">{{ gt('setup.needTwoPlayers') }}</p>
      <button class="btn btn-primary btn-lg" type="button" :disabled="names.length < 2" @click="start">
        {{ gt('setup.start') }}
      </button>
    </div>

    <div v-else-if="stage === 'ready'" class="card center">
      <p class="muted">{{ gt('ready.passTo') }}</p>
      <h2>{{ state.players[state.describerIndex] }}</h2>
      <button class="btn btn-primary btn-lg" type="button" autofocus @click="beginTurn">{{ gt('ready.ready') }}</button>
    </div>

    <div v-else-if="stage === 'describing' && state.word" class="describing">
      <div class="progress" aria-hidden="true">
        <i :style="{ width: `${(state.secondsLeft / settings.roundSeconds) * 100}%` }" />
      </div>
      <div class="card word-card">
        <p class="taboo-label">{{ gt('describing.taboo') }}</p>
        <ul class="taboo-list">
          <li v-for="w in state.word.taboo" :key="w">{{ w }}</li>
        </ul>
        <h2 class="target-word">{{ state.word.item.target }}</h2>
      </div>
      <div class="actions">
        <button class="btn btn-danger btn-lg" type="button" @click="skip">⏭ {{ gt('describing.skip') }}</button>
        <button class="btn btn-accent btn-lg" type="button" @click="correct">✓ {{ gt('describing.correct') }}</button>
      </div>
      <p class="muted small tally">
        {{ gt('describing.tally', { correct: state.correctThisTurn, skipped: state.skippedThisTurn }) }}
      </p>
    </div>

    <div v-else-if="stage === 'turnOver'" class="card center">
      <h2>{{ gt('turnOver.title', { name: state.players[state.describerIndex] }) }}</h2>
      <p class="muted">{{ gt('turnOver.summary', { correct: state.correctThisTurn, skipped: state.skippedThisTurn }) }}</p>
      <button class="btn btn-primary btn-lg" type="button" autofocus @click="afterTurn">{{ gt('turnOver.next') }}</button>
    </div>

    <ResultScreen v-else-if="stage === 'finished'" :title="gt('finished.winner', { name: top.name })" @again="playAgain">
      <ol class="scoreboard">
        <li v-for="(p, i) in ranked" :key="p.name">
          <span class="rank">{{ i + 1 }}.</span>
          <span class="pname">{{ p.name }}</span>
          <span class="pscore">{{ gt('finished.words', { n: p.score }, p.score) }}</span>
        </li>
      </ol>
    </ResultScreen>
  </GameShell>
</template>

<style scoped>
.setup {
  max-width: 440px;
  margin: 16px auto;
  padding: 24px;
  text-align: center;
}
.add-form {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  margin: 16px 0;
}
.add-form .field {
  flex: 1;
}
.names {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}
.names li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 6px 6px 12px;
  border-radius: 999px;
  background: var(--surface-2);
  font-weight: 600;
}
.names .remove {
  border: none;
  background: none;
  cursor: pointer;
  font-size: 1.1rem;
  line-height: 1;
  color: var(--muted);
  padding: 4px;
}
.small {
  font-size: 0.9rem;
}

.center {
  max-width: 420px;
  margin: 40px auto;
  padding: 32px 24px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
}

.describing {
  max-width: 480px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-top: 8px;
}
.progress {
  height: 8px;
  border-radius: 999px;
  background: var(--surface-2);
  overflow: hidden;
}
.progress i {
  display: block;
  height: 100%;
  background: var(--accent);
  border-radius: inherit;
  transition: width 1s linear;
}
.word-card {
  padding: 28px 20px;
  text-align: center;
}
.taboo-label {
  margin: 0 0 6px;
  font-weight: 700;
  color: var(--bad);
  text-transform: uppercase;
  font-size: 0.8rem;
  letter-spacing: 0.04em;
}
.taboo-list {
  list-style: none;
  margin: 0 0 20px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.taboo-list li {
  color: var(--muted);
  text-decoration: line-through;
  font-weight: 600;
}
.target-word {
  font-size: 2.4rem;
  margin: 0;
}
.actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.tally {
  text-align: center;
}

.scoreboard {
  list-style: none;
  margin: 0;
  padding: 0;
  text-align: left;
}
.scoreboard li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
}
.scoreboard .rank {
  color: var(--muted);
  font-weight: 700;
  width: 1.5em;
}
.scoreboard .pname {
  flex: 1;
  font-weight: 600;
}
.scoreboard .pscore {
  color: var(--muted);
}
</style>
