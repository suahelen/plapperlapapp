<script setup lang="ts">
import { useGameT } from '../i18n'
import { computed, ref, shallowRef } from 'vue'
import type { GameProps } from '../types'
import type { Balloon as BalloonT, BalloonPopSettings, BalloonState } from './types'
import { createGame, escape, finish, hasNextRound, makeRound, startRound, tap } from './logic'
import Balloon from './Balloon.vue'
import GameShell from '../shared/ui/GameShell.vue'
import ResultScreen from '../shared/ui/ResultScreen.vue'
import PromptCard from '../shared/answer/PromptCard.vue'
import { WordQueue } from '../shared/wordQueue'
import { useTimers } from '../shared/timing'

const props = defineProps<GameProps<BalloonPopSettings>>()
const gt = useGameT('balloon-pop')
const { wait, cancelAll } = useTimers()

const stage = ref<'intro' | 'playing' | 'done'>('intro')
const state = shallowRef<BalloonState>(createGame(props.settings))
const roundKey = ref(0)
const shaking = ref(false)
let queue = new WordQueue(props.vocabulary)
let missedThisRound = false

const round = computed(() => state.value.round)
const correctText = computed(() => round.value?.balloons.find((b) => b.correct)?.text ?? '')

function start() {
  cancelAll()
  queue = new WordQueue(props.vocabulary)
  state.value = createGame(props.settings)
  stage.value = 'playing'
  nextRound()
}

function restart() {
  cancelAll()
  stage.value = 'intro'
}

function nextRound() {
  missedThisRound = false
  state.value = startRound(
    state.value,
    makeRound(queue.next(), props.vocabulary, props.settings, state.value.speedFactor),
  )
  roundKey.value++
}

function onTap(b: BalloonT) {
  const before = state.value
  state.value = tap(before, b.id)
  if (state.value === before) return
  if (!b.correct) {
    missedThisRound = true
    shaking.value = true
    wait(320).then(() => (shaking.value = false))
  }
  afterChange()
}

function onGone(b: BalloonT) {
  if (!b.correct || b.popped) return
  state.value = escape(state.value)
  afterChange()
}

async function afterChange() {
  const s = state.value
  if (s.phase === 'playing') return
  if ((s.outcome === 'escaped' || missedThisRound) && s.round) queue.retryLater(s.round.prompt.item)

  if (s.phase === 'finished') {
    await wait(1400)
    stage.value = 'done'
    return
  }
  await wait(s.outcome === 'hit' ? 750 : 1600)
  if (hasNextRound(state.value)) {
    nextRound()
  } else {
    state.value = finish(state.value)
    stage.value = 'done'
  }
}

const ratio = computed(() => (state.value.roundIndex ? state.value.score / state.value.roundIndex : 0))
const survived = computed(() => state.value.lives > 0)
</script>

<template>
  <GameShell :title="gt('name')" @restart="restart">
    <template #status>
      <template v-if="stage === 'playing'">
        <span class="hearts" :aria-label="gt('livesLabel', { n: state.lives }, state.lives)">
          <span v-for="n in settings.lives" :key="n" :class="{ lost: n > state.lives }">♥</span>
        </span>
        <span class="score">⭐ {{ state.score }}</span>
      </template>
    </template>

    <div v-if="stage === 'intro'" class="intro card">
      <div class="intro-art" aria-hidden="true">🎈</div>
      <h2>{{ gt('name') }}</h2>
      <p class="muted">{{ gt('intro') }}</p>
      <p class="muted small">{{ gt('roundsLives', { rounds: settings.rounds, lives: settings.lives }) }}</p>
      <button class="btn btn-primary btn-lg" type="button" @click="start">{{ gt('start') }}</button>
    </div>

    <div v-else-if="stage === 'playing' && round" class="playfield">
      <div class="top">
        <PromptCard :key="roundKey" :prompt="round.prompt" compact class="prompt-in" />
        <div class="progress" aria-hidden="true">
          <i :style="{ width: `${(state.roundIndex / state.totalRounds) * 100}%` }" />
        </div>
      </div>

      <div class="sky" :class="{ shake: shaking }">
        <div class="cloud c1" aria-hidden="true" />
        <div class="cloud c2" aria-hidden="true" />
        <div class="cloud c3" aria-hidden="true" />

        <div :key="roundKey" class="balloons">
          <Balloon
            v-for="b in round.balloons"
            :key="b.id"
            :balloon="b"
            :duration="round.duration"
            :paused="state.phase !== 'playing'"
            @tap="onTap(b)"
            @gone="onGone(b)"
          />
        </div>

        <Transition name="toast">
          <div v-if="state.phase !== 'playing'" class="toast" :class="state.outcome === 'hit' ? 'good' : 'bad'" role="status">
            <template v-if="state.outcome === 'hit'">+1 ⭐</template>
            <template v-else>
              <span v-if="state.outcome === 'escaped'">{{ gt('escaped') }}</span>
              <span v-else>{{ gt('noLives') }}</span>
              <i18n-t keypath="games.balloon-pop.correct" tag="small">
                <template #answer><strong>{{ correctText }}</strong></template>
              </i18n-t>
            </template>
          </div>
        </Transition>
      </div>
    </div>

    <ResultScreen
      v-else-if="stage === 'done'"
      :title="survived ? gt('survived') : gt('outOfLives')"
      :subtitle="gt('result', { score: state.score, total: state.roundIndex, streak: state.bestStreak })"
      :ratio="ratio"
      @again="start"
    />
  </GameShell>
</template>

<style scoped>
.intro {
  max-width: 440px;
  margin: 16px auto;
  text-align: center;
  padding: 28px 22px;
  box-shadow: var(--shadow);
}
.intro-art {
  font-size: 3.4rem;
  line-height: 1;
  animation: bob 2.4s ease-in-out infinite alternate;
}
.small {
  font-size: 0.9rem;
}
@keyframes bob {
  to {
    transform: translateY(-8px) rotate(4deg);
  }
}

.playfield {
  display: flex;
  flex-direction: column;
  gap: 10px;
  /* Fill the viewport below the header. */
  height: calc(100dvh - 90px);
  min-height: 420px;
}
.top {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.prompt-in {
  animation: drop 0.35s var(--ease-bounce);
}
@keyframes drop {
  from {
    transform: translateY(-10px);
    opacity: 0;
  }
}
.progress {
  height: 6px;
  border-radius: 999px;
  background: var(--surface-2);
  overflow: hidden;
}
.progress i {
  display: block;
  height: 100%;
  background: var(--accent);
  border-radius: inherit;
  transition: width 0.4s ease;
}

.sky {
  position: relative;
  flex: 1;
  overflow: hidden;
  border-radius: var(--radius-lg);
  background: linear-gradient(180deg, var(--sky-top) 0%, var(--sky-mid) 55%, var(--sky-bottom) 100%);
  border: 1px solid var(--sky-edge);
  container-type: size;
  user-select: none;
}
.sky.shake {
  animation: shake 0.3s ease;
}
@keyframes shake {
  25% {
    transform: translateX(-6px);
  }
  75% {
    transform: translateX(6px);
  }
}
.balloons {
  position: absolute;
  inset: 0;
}
.cloud {
  position: absolute;
  width: 120px;
  height: 36px;
  border-radius: 999px;
  background: var(--surface-bright);
  opacity: 0.8;
  filter: blur(0.5px);
}
.cloud::before,
.cloud::after {
  content: '';
  position: absolute;
  background: var(--surface-bright);
  border-radius: 50%;
}
.cloud::before {
  width: 56px;
  height: 56px;
  top: -26px;
  left: 18px;
}
.cloud::after {
  width: 40px;
  height: 40px;
  top: -16px;
  left: 62px;
}
.c1 {
  top: 14%;
  left: 6%;
  animation: drift 40s linear infinite alternate;
}
.c2 {
  top: 42%;
  right: 4%;
  transform: scale(0.7);
  animation: drift 55s linear infinite alternate-reverse;
}
.c3 {
  top: 72%;
  left: 30%;
  transform: scale(0.5);
  opacity: 0.6;
}
@keyframes drift {
  to {
    translate: 60px 0;
  }
}

.hearts {
  color: var(--bad);
  font-size: 1.15rem;
  letter-spacing: 1px;
}
.hearts .lost {
  color: var(--line);
}
.score {
  font-size: 1.05rem;
}

.toast {
  position: absolute;
  left: 50%;
  top: 40%;
  translate: -50% -50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 14px 24px;
  border-radius: var(--radius);
  background: var(--surface-bright);
  box-shadow: var(--shadow-lg);
  font: 800 1.4rem var(--font-display);
  text-align: center;
  z-index: 5;
  pointer-events: none;
}
.toast.good {
  color: var(--good);
}
.toast.bad {
  color: var(--bad);
}
.toast small {
  font: 600 1rem var(--font);
  color: var(--ink);
}
.toast-enter-active {
  transition:
    transform 0.3s var(--ease-bounce),
    opacity 0.2s;
}
.toast-enter-from {
  transform: scale(0.6);
  opacity: 0;
}
</style>
