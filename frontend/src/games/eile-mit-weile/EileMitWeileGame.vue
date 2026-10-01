<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useGameT } from '../i18n'
import { computed, ref, shallowRef } from 'vue'
import type { GameProps } from '../types'
import type { EileMitWeileSettings, GameState, PlayerColor } from './types'
import {
  COLORS,
  answer,
  choosePawn,
  cpuAnswers,
  cpuPickPawn,
  createGame,
  movablePawns,
  movePath,
  rollDie,
  type PlayerSetup,
} from './logic'
import Board, { type PawnView } from './Board.vue'
import Die from './Die.vue'
import GameShell from '../shared/ui/GameShell.vue'
import ResultScreen from '../shared/ui/ResultScreen.vue'
import PromptCard from '../shared/answer/PromptCard.vue'
import AnswerInput from '../shared/answer/AnswerInput.vue'
import { buildChoices, makePrompt, type AnswerResult, type Prompt } from '../shared/answer/prompt'
import { WordQueue } from '../shared/wordQueue'
import { randomInt } from '../shared/random'
import { useTimers } from '../shared/timing'

const props = defineProps<GameProps<EileMitWeileSettings>>()
const gt = useGameT('eile-mit-weile')
const { t } = useI18n()
/** Players without a name are shown by their colour; the computer as "Computer". */
const nameOf = (p: { name: string; color: PlayerColor; isCpu: boolean }) =>
  p.isCpu ? gt('computer') : p.name || gt(`colors.${p.color}`)
const { wait, cancelAll } = useTimers()

const COLOR_VAR: Record<PlayerColor, string> = {
  red: 'var(--player-red)',
  blue: 'var(--player-blue)',
  green: 'var(--player-green)',
  yellow: 'var(--player-yellow)',
}

// --- setup ---------------------------------------------------------------
const stage = ref<'setup' | 'playing' | 'done'>('setup')
const humanCount = ref(1)
const withCpu = ref(true)

// --- game state ------------------------------------------------------------
const state = shallowRef<GameState>(createGame([{ isCpu: false }], config()))
let queue = new WordQueue(props.vocabulary)

const rolling = ref(false)
const busy = ref(false)
const prompt = shallowRef<Prompt | null>(null)
const choices = ref<string[] | undefined>()
const promptKey = ref(0)
const result = ref<AnswerResult | null>(null)
const cpuThinking = ref(false)

/** Animation override: the moving pawn's displayed progress and pawns about to be captured. */
const anim = shallowRef<{ player: number; pawn: number; progress: number; captured: GameState['lastMove'] } | null>(null)

function config() {
  return {
    trackLength: props.settings.boardSize,
    homeLength: 4,
    pawnsPerPlayer: props.settings.pawnsPerPlayer,
    sixRollsAgain: props.settings.sixRollsAgain,
  }
}

const current = computed(() => state.value.players[state.value.current])
const humanTurn = computed(() => stage.value === 'playing' && !current.value.isCpu && !busy.value)

const pawnViews = computed<PawnView[]>(() => {
  const s = state.value
  const movable = s.phase === 'choose-pawn' && humanTurn.value ? movablePawns(s) : []
  return s.players.flatMap((pl, pi) =>
    pl.pawns.map((progress, i) => {
      let shown = progress
      const a = anim.value
      if (a) {
        if (a.player === pi && a.pawn === i) shown = a.progress
        const cap = a.captured?.captured.find((c) => c.player === pi && c.pawn === i)
        if (cap) shown = cap.from
      }
      return {
        player: pi,
        pawn: i,
        color: pl.color,
        progress: shown,
        movable: pi === s.current && movable.includes(i),
      }
    }),
  )
})

const statusText = computed(() => {
  const s = state.value
  const who = current.value.isCpu ? gt('computerName') : nameOf(current.value)
  if (busy.value) return gt('status.moving', { name: who })
  switch (s.phase) {
    case 'roll':
      return current.value.isCpu ? gt('status.cpuRolls') : gt('status.yourTurnRoll', { name: who })
    case 'answer':
      return current.value.isCpu ? gt('status.cpuThinks') : gt('status.translate', { n: s.roll }, s.roll ?? 0)
    case 'choose-pawn':
      return gt('status.choosePawn')
    default:
      return ''
  }
})

// --- flow ------------------------------------------------------------------
function start() {
  cancelAll()
  const setup: PlayerSetup[] = Array.from({ length: humanCount.value }, () => ({ isCpu: false }))
  if (withCpu.value && humanCount.value < 4) setup.push({ isCpu: true })
  state.value = createGame(setup, config())
  queue = new WordQueue(props.vocabulary)
  prompt.value = null
  result.value = null
  anim.value = null
  busy.value = false
  rolling.value = false
  cpuThinking.value = false
  stage.value = 'playing'
  maybeCpuTurn()
}

function restart() {
  cancelAll()
  stage.value = 'setup'
}

async function roll() {
  if (state.value.phase !== 'roll' || rolling.value || busy.value) return
  rolling.value = true
  await wait(650)
  const value = randomInt(1, 6)
  rolling.value = false
  state.value = rollDie(state.value, value)
  await wait(250)
  nextPrompt()
  if (current.value.isCpu) await cpuAnswer()
}

function nextPrompt() {
  const p = makePrompt(queue.next(), props.settings.direction)
  prompt.value = p
  choices.value = props.settings.answerModes.includes('choice') ? buildChoices(p, props.vocabulary, 4) : undefined
  result.value = null
  promptKey.value++
}

async function onAnswer(r: AnswerResult) {
  result.value = r
  if (r.correct) {
    await wait(900)
    commitAnswer(true)
  }
  // Wrong answers wait for "Weiter" so the correct answer can be read.
}

function commitAnswer(correct: boolean) {
  if (!correct && prompt.value) queue.retryLater(prompt.value.item)
  prompt.value = null
  result.value = null
  advance(answer(state.value, correct))
}

async function cpuAnswer() {
  cpuThinking.value = true
  await wait(1200)
  const correct = cpuAnswers(Math.random)
  cpuThinking.value = false
  result.value = { correct, given: '', expected: prompt.value!.expected }
  await wait(1100)
  commitAnswer(correct)
}

function onPick(pawn: number) {
  if (!humanTurn.value) return
  advance(choosePawn(state.value, pawn))
}

/** Applies a new state, animating a move if one happened, then continues the turn flow. */
async function advance(next: GameState) {
  const move = next.lastMove
  if (move && next.lastMove !== state.value.lastMove) {
    busy.value = true
    anim.value = { player: move.player, pawn: move.pawn, progress: move.from, captured: move }
    state.value = next
    for (const step of movePath(move.from, move.to)) {
      await wait(210)
      anim.value = { ...anim.value!, progress: step }
    }
    if (move.captured.length) await wait(350)
    anim.value = null
    busy.value = false
  } else {
    state.value = next
  }

  if (next.phase === 'finished') {
    await wait(800)
    stage.value = 'done'
    return
  }
  if (next.phase === 'choose-pawn' && current.value.isCpu) {
    await wait(500)
    return advance(choosePawn(state.value, cpuPickPawn(state.value)))
  }
  maybeCpuTurn()
}

async function maybeCpuTurn() {
  if (stage.value !== 'playing' || state.value.phase !== 'roll' || !current.value.isCpu) return
  await wait(800)
  await roll()
}

// --- results ---------------------------------------------------------------
const winner = computed(() => (state.value.winner === null ? null : state.value.players[state.value.winner]))
const humanRatio = computed(() => {
  const humans = state.value.players.filter((p) => !p.isCpu)
  const answered = humans.reduce((n, p) => n + p.answered, 0)
  return answered ? humans.reduce((n, p) => n + p.correct, 0) / answered : 0
})
</script>

<template>
  <GameShell :title="gt('name')" @restart="restart">
    <template #status>
      <template v-if="stage === 'playing'">
        <span
          v-for="(p, i) in state.players"
          :key="i"
          class="chip"
          :class="{ active: i === state.current }"
          :style="{ '--c': COLOR_VAR[p.color] }"
          :title="nameOf(p)"
        >
          <i />{{ p.isCpu ? '🤖' : p.correct }}
        </span>
      </template>
    </template>

    <!-- setup -->
    <div v-if="stage === 'setup'" class="setup card">
      <div class="setup-icon" aria-hidden="true">🎲</div>
      <h2>{{ gt('name') }}</h2>
      <p class="muted">{{ gt('intro') }}</p>

      <label>{{ gt('howMany') }}</label>
      <div class="count-picker">
        <button
          v-for="n in 4"
          :key="n"
          type="button"
          class="count"
          :class="{ on: humanCount === n }"
          @click="humanCount = n"
        >
          <span class="dots">
            <i v-for="k in n" :key="k" :style="{ background: COLOR_VAR[COLORS[[0, 2, 1, 3][k - 1]]] }" />
          </span>
          {{ n }}
        </button>
      </div>

      <label v-if="humanCount < 4" class="check cpu-toggle">
        <input v-model="withCpu" type="checkbox" />
        {{ gt('vsCpu') }}
      </label>

      <button class="btn btn-primary btn-lg" type="button" @click="start">{{ gt('go') }}</button>
    </div>

    <!-- playing -->
    <div v-else-if="stage === 'playing'" class="play">
      <div class="turn" :style="{ '--c': COLOR_VAR[current.color] }">
        <i class="turn-dot" />
        <span>{{ statusText }}</span>
      </div>

      <Board
        :config="state.config"
        :pawns="pawnViews"
        :active-color="current.color"
        :used-colors="state.players.map((p) => p.color)"
        @pick="onPick"
      />

      <div class="panel">
        <!-- roll -->
        <div v-if="state.phase === 'roll' || rolling" class="roll-row">
          <Die :value="state.roll" :rolling="rolling" :color="COLOR_VAR[current.color]" />
          <button
            v-if="!current.isCpu"
            class="btn btn-primary btn-lg"
            type="button"
            :disabled="rolling || busy"
            @click="roll"
          >
            {{ gt('roll') }}
          </button>
        </div>

        <!-- answer -->
        <Transition name="slide" mode="out-in">
          <div v-if="state.phase === 'answer' && prompt && !rolling" :key="promptKey" class="answer-box">
            <div class="answer-head">
              <Die :value="state.roll" :rolling="false" :color="COLOR_VAR[current.color]" class="mini-die" />
              <PromptCard :prompt="prompt" compact class="grow" />
            </div>

            <template v-if="!current.isCpu">
              <AnswerInput :prompt="prompt" :modes="settings.answerModes" :choices="choices" @answer="onAnswer" />
              <button
                v-if="result && !result.correct"
                class="btn btn-accent btn-lg"
                type="button"
                autofocus
                @click="commitAnswer(false)"
              >
                {{ t('game.next') }}
              </button>
            </template>
            <div v-else class="cpu-box" role="status">
              <span v-if="cpuThinking" class="thinking">🤖 <i /><i /><i /></span>
              <span v-else-if="result" :class="result.correct ? 'good' : 'bad'">
                🤖 {{ result.correct ? gt('cpuKnows', { expected: result.expected }) : gt('cpuDoesntKnow') }}
              </span>
            </div>
          </div>
        </Transition>
      </div>
    </div>

    <!-- done -->
    <ResultScreen
      v-else
      :title="winner?.isCpu ? gt('cpuWins') : gt('wins', { name: winner ? nameOf(winner) : '' })"
      :subtitle="gt('afterRounds', { n: state.turn }, state.turn)"
      :ratio="humanRatio"
      @again="start"
    >
      <ul class="stats">
        <li v-for="(p, i) in state.players" :key="i" :style="{ '--c': COLOR_VAR[p.color] }">
          <i />
          <span>{{ nameOf(p) }}</span>
          <strong>{{ t('game.rightCount', { correct: p.correct, answered: p.answered }) }}</strong>
        </li>
      </ul>
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
.setup h2 {
  margin: 0;
}
.setup p {
  margin: 0;
}
.setup-icon {
  font-size: 3rem;
  line-height: 1;
}
.count-picker {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.count {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 4px;
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
.dots {
  display: flex;
  gap: 3px;
  height: 10px;
}
.dots i {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.cpu-toggle {
  justify-content: center;
}

.play {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.play :deep(.board) {
  max-width: min(560px, 58dvh);
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
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--c) 30%, transparent);
}
.panel {
  min-height: 120px;
}
.roll-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  padding: 8px;
}
.answer-box {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.answer-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.mini-die {
  width: 52px;
  height: 52px;
  flex: none;
}
.grow {
  flex: 1;
  min-width: 0;
}
.cpu-box {
  text-align: center;
  font-weight: 700;
  font-size: 1.1rem;
  padding: 12px;
}
.cpu-box .good {
  color: var(--good);
}
.cpu-box .bad {
  color: var(--bad);
}
.thinking i {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin: 0 2px;
  border-radius: 50%;
  background: var(--muted);
  animation: blink 1s infinite;
}
.thinking i:nth-child(2) {
  animation-delay: 0.2s;
}
.thinking i:nth-child(3) {
  animation-delay: 0.4s;
}
@keyframes blink {
  50% {
    opacity: 0.2;
  }
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 0.9rem;
  background: var(--surface);
  border: 1.5px solid var(--line);
}
.chip i,
.stats i {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--c);
}
.chip.active {
  border-color: var(--c);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--c) 30%, transparent);
}

.stats {
  list-style: none;
  padding: 0;
  margin: 0 0 20px;
  text-align: left;
}
.stats li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
}
.stats strong {
  margin-left: auto;
}

.slide-enter-active,
.slide-leave-active {
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}
.slide-enter-from {
  transform: translateY(10px);
  opacity: 0;
}
.slide-leave-to {
  opacity: 0;
}
</style>
