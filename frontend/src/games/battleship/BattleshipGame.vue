<script setup lang="ts">
import { useGameT } from '../i18n'
import { useI18n } from 'vue-i18n'
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { GameProps } from '../types'
import type { BattleshipSettings, BattleshipView, ShotEvent } from './types'
import Grid from './Grid.vue'
import { choicesForCell, promptForCell } from './cells'
import GameShell from '../shared/ui/GameShell.vue'
import ResultScreen from '../shared/ui/ResultScreen.vue'
import PromptCard from '../shared/answer/PromptCard.vue'
import AnswerInput from '../shared/answer/AnswerInput.vue'
import type { AnswerResult, Prompt } from '../shared/answer/prompt'
import RoomLobby from '../shared/room/RoomLobby.vue'
import { useRoom, type Room } from '../shared/room/useRoom'
import { useTimers } from '../shared/timing'

const props = defineProps<GameProps<BattleshipSettings>>()
const gt = useGameT('battleship')
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { wait } = useTimers()

// The server holds the game; this component only renders views and sends actions.
const room = useRoom<BattleshipView>(String(route.params.publicId), 'battleship')
const view = computed(() => room.envelope.value?.view ?? null)
const waiting = computed(() => !view.value || view.value.phase === 'waiting')
const opponentOnline = computed(() => {
  const v = view.value
  return !!v && !!room.envelope.value?.online[1 - v.you]
})
const myTurn = computed(() => view.value?.phase === 'playing' && view.value.turn === view.value.you)

// --- shooting ------------------------------------------------------------------
const selected = ref<[number, number] | null>(null)
const prompt = shallowRef<Prompt | null>(null)
const choices = ref<string[] | undefined>()
const promptKey = ref(0)

function pick(r: number, c: number) {
  const v = view.value
  if (!v || !myTurn.value) return
  selected.value = [r, c]
  prompt.value = promptForCell(v.cells[r][c], props.vocabulary)
  choices.value = props.settings.answerModes.includes('choice') ? choicesForCell(prompt.value, props.vocabulary) : undefined
  promptKey.value++
}

async function onAnswer(res: AnswerResult) {
  if (!selected.value) return
  const [row, col] = selected.value
  await room.send({ type: 'shoot', row, col, answer: res.given })
  selected.value = null
  prompt.value = null
}

// Deselect when the turn passes (e.g. after a wrong answer).
watch(myTurn, (mine) => {
  if (!mine) {
    selected.value = null
    prompt.value = null
  }
})

// --- feedback -------------------------------------------------------------------
const toast = ref<{ text: string; tone: 'good' | 'bad' | 'info'; detail?: string } | null>(null)
let lastSeq = 0

watch(
  () => view.value?.lastEvent,
  async (ev) => {
    if (!ev || ev.seq === lastSeq || !view.value) return
    const first = lastSeq === 0
    lastSeq = ev.seq
    if (first && room.envelope.value && room.envelope.value.version > 1) return // don't replay on reconnect
    toast.value = describe(ev, ev.seat === view.value.you)
    const shown = ev.seq
    await wait(ev.kind === 'wrong' ? 3200 : 2000)
    if (lastSeq === shown) toast.value = null
  },
)

function describe(ev: ShotEvent, mine: boolean): NonNullable<typeof toast.value> {
  if (mine) {
    switch (ev.kind) {
      case 'wrong':
        return { text: gt('toast.wrong'), tone: 'bad', detail: t('game.correctWas', { expected: ev.expected }) }
      case 'miss':
        return { text: gt('toast.miss'), tone: 'info' }
      case 'hit':
        return { text: gt('toast.hit'), tone: 'good' }
      case 'sunk':
        return { text: gt('toast.sunk'), tone: 'good' }
    }
  }
  switch (ev.kind) {
    case 'wrong':
      return { text: gt('toast.oppWrong'), tone: 'info', detail: t('game.correctWas', { expected: ev.expected }) }
    case 'miss':
      return { text: gt('toast.oppMiss'), tone: 'info' }
    case 'hit':
      return { text: gt('toast.oppHit'), tone: 'bad' }
    case 'sunk':
      return { text: gt('toast.oppSunk'), tone: 'bad' }
  }
}

// --- status -----------------------------------------------------------------------
const oppSunk = computed(() => view.value?.opponent.ships?.length ?? 0)
const mySunk = computed(() => {
  const v = view.value
  if (!v?.me.ships) return 0
  return v.me.ships.filter((ship) => ship.every(([r, c]) => v.opponent.shots[r][c] >= 2)).length
})
const lastOnTarget = computed(() => {
  const ev = view.value?.lastEvent
  return ev && ev.seat === view.value?.you ? ev : null
})
const lastOnMe = computed(() => {
  const ev = view.value?.lastEvent
  return ev && ev.seat !== view.value?.you ? ev : null
})

function leave() {
  room.leave()
  lastSeq = 0
  router.replace({ query: {} })
}
</script>

<template>
  <GameShell :title="gt('name')" @restart="leave">
    <template #status>
      <span
        v-if="room.ticket.value"
        class="conn"
        :class="room.connection.value"
        :title="room.connection.value === 'open' ? gt('connected') : gt('connecting')"
      />
    </template>

    <!-- room gone -->
    <div v-if="room.connection.value === 'gone'" class="card notice">
      <h2>{{ t('game.unavailable') }}</h2>
      <p class="muted">{{ t('game.unavailableText') }}</p>
      <button class="btn btn-primary" type="button" @click="leave">{{ t('game.newGame') }}</button>
    </div>

    <!-- lobby / waiting -->
    <RoomLobby
      v-else-if="waiting"
      :room="room as Room<unknown>"
      :title="gt('name')"
      icon="🚢"
      :intro="gt('intro')"
      :min-players="2"
      :max-players="2"
      auto-start
    />

    <template v-else-if="view">
      <div v-if="!opponentOnline && view.phase !== 'finished'" class="alert offline">
        {{ gt('oppOffline') }}
      </div>
      <div v-if="room.error.value" class="alert" role="alert">{{ room.error.value }}</div>

      <!-- placing -->
      <section v-if="view.phase === 'placing'" class="stack placing">
        <div class="banner">
          <strong>{{ gt('yourFleet') }}</strong>
          <span class="muted">{{ gt('fleet', { n: view.fleet.length, sizes: view.fleet.join(', ') }) }}</span>
        </div>
        <Grid
          :rows="view.rows"
          :cols="view.cols"
          :cells="view.cells"
          variant="own"
          :ships="view.me.ships"
          :shots="view.opponent.shots"
        />
        <div class="row center">
          <button class="btn" type="button" :disabled="view.me.ready || room.busy.value" @click="room.send({ type: 'reshuffle' })">
            🔀 {{ gt('reshuffle') }}
          </button>
          <button class="btn btn-primary btn-lg" type="button" :disabled="view.me.ready || room.busy.value" @click="room.send({ type: 'ready' })">
            {{ view.me.ready ? gt('isReady') : gt('ready') }}
          </button>
        </div>
        <p class="muted center-text">
          {{ view.opponent.ready ? gt('oppReady') : gt('oppPlacing') }}
        </p>
      </section>

      <!-- playing -->
      <section v-else-if="view.phase === 'playing'" class="stack">
        <div class="banner" :class="{ mine: myTurn }">
          <strong>{{ myTurn ? gt('yourTurn') : gt('oppTurn') }}</strong>
          <span class="score">💥 {{ oppSunk }}/{{ view.fleet.length }} · 🛡️ {{ view.fleet.length - mySunk }}/{{ view.fleet.length }}</span>
        </div>

        <div class="target-wrap">
          <Grid
            :rows="view.rows"
            :cols="view.cols"
            :cells="view.cells"
            variant="target"
            :ships="view.opponent.ships"
            :shots="view.me.shots"
            :clickable="myTurn && !room.busy.value"
            :selected="selected"
            :last-shot="lastOnTarget"
            @pick="pick"
          />
          <Transition name="toast">
            <div v-if="toast" class="toast" :class="toast.tone" role="status">
              <span>{{ toast.text }}</span>
              <small v-if="toast.detail">{{ toast.detail }}</small>
            </div>
          </Transition>
        </div>

        <Transition name="slide">
          <div v-if="prompt && selected" :key="promptKey" class="answer-box card">
            <div class="cell-label">
              {{ gt('cell') }} <strong>{{ view.rows[selected[0]] }} · {{ view.cols[selected[1]] }}</strong>
              <button class="btn btn-ghost btn-icon" type="button" :aria-label="t('common.cancel')" @click="selected = null; prompt = null">✕</button>
            </div>
            <PromptCard :prompt="prompt" compact />
            <AnswerInput :prompt="prompt" :modes="settings.answerModes" :choices="choices" deferred @answer="onAnswer" />
          </div>
        </Transition>

        <details class="own" open>
          <summary>{{ gt('yourFleet') }}</summary>
          <Grid
            :rows="view.rows"
            :cols="view.cols"
            :cells="view.cells"
            variant="own"
            :ships="view.me.ships"
            :shots="view.opponent.shots"
            :last-shot="lastOnMe"
            compact
          />
        </details>
      </section>

      <!-- finished -->
      <ResultScreen
        v-else-if="view.phase === 'finished'"
        :title="view.winner === view.you ? gt('won') : gt('lost')"
        :subtitle="view.winner === view.you ? gt('wonText') : gt('lostText')"
        :ratio="view.winner === view.you ? 1 : undefined"
        @again="room.send({ type: 'rematch' })"
      >
        <p class="muted small">{{ gt('oppFleet') }}</p>
        <Grid
          :rows="view.rows"
          :cols="view.cols"
          :cells="view.cells"
          variant="target"
          :ships="view.opponent.ships"
          :shots="view.me.shots"
          compact
          class="reveal"
        />
      </ResultScreen>
    </template>
  </GameShell>
</template>

<style scoped>
.notice {
  max-width: 440px;
  margin: 24px auto;
  text-align: center;
}
.offline {
  margin-bottom: 12px;
}
.stack > * {
  min-width: 0;
}
.banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px 12px;
  padding: 10px 14px;
  border-radius: var(--radius);
  background: var(--surface);
  border: 1.5px solid var(--line);
}
.banner.mine {
  border-color: var(--primary);
  background: var(--primary-soft);
}
.score {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.center {
  justify-content: center;
}
.center-text {
  text-align: center;
  margin: 0;
}
.target-wrap {
  position: relative;
}
.answer-box {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-color: var(--primary);
  box-shadow: var(--shadow);
}
.cell-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.95rem;
}
.own summary {
  cursor: pointer;
  font-weight: 700;
  margin-bottom: 8px;
}
.toast {
  position: absolute;
  left: 50%;
  top: 50%;
  translate: -50% -50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 12px 20px;
  border-radius: var(--radius);
  background: var(--surface-bright);
  box-shadow: var(--shadow-lg);
  font: 800 1.2rem var(--font-display);
  text-align: center;
  pointer-events: none;
  z-index: 5;
  max-width: 90%;
}
.toast.good {
  color: var(--good);
}
.toast.bad {
  color: var(--bad);
}
.toast small {
  font: 600 0.95rem var(--font);
  color: var(--ink);
}
.conn {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--player-yellow);
}
.conn.open {
  background: var(--good);
}
.conn.gone {
  background: var(--bad);
}
.small {
  font-size: 0.9rem;
}
.reveal {
  margin-bottom: 20px;
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
.toast-leave-active {
  transition: opacity 0.3s;
}
.toast-leave-to {
  opacity: 0;
}
.slide-enter-active {
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}
.slide-enter-from {
  transform: translateY(10px);
  opacity: 0;
}
</style>
