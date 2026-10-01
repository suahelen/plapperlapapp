<script setup lang="ts">
import { useGameT } from '../i18n'
import { useI18n } from 'vue-i18n'
import { playerName } from '../shared/room/names'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { GameProps } from '../types'
import type { KaboomSettings } from './types'
import type { KaboomRoomView } from './roomTypes'
import Cup from './Cup.vue'
import KaboomBlast from './KaboomBlast.vue'
import GameShell from '../shared/ui/GameShell.vue'
import ResultScreen from '../shared/ui/ResultScreen.vue'
import PromptCard from '../shared/answer/PromptCard.vue'
import AnswerInput from '../shared/answer/AnswerInput.vue'
import { buildChoices, type AnswerResult } from '../shared/answer/prompt'
import RoomLobby from '../shared/room/RoomLobby.vue'
import RoomPlayers from '../shared/room/RoomPlayers.vue'
import { useRoom, type Room } from '../shared/room/useRoom'
import { seatColor } from '../shared/room/colors'
import { fromRoomPrompt } from '../shared/room/roomPrompt'

const props = defineProps<GameProps<KaboomSettings>>()
const gt = useGameT('kaboom')
const { t } = useI18n()
const nameAt = (seat: number) => playerName(view.value?.players[seat]?.name, seat)
const route = useRoute()
const router = useRouter()

const room = useRoom<KaboomRoomView>(String(route.params.publicId), 'kaboom')
const view = computed(() => room.envelope.value?.view ?? null)
const inLobby = computed(() => !view.value || view.value.phase === 'lobby')
const myTurn = computed(() => !!view.value && view.value.turn === view.value.you)
const isHost = computed(() => view.value?.you === 0)

// --- drawing: lift the stick right away on this screen --------------------------
const drawing = ref(false)
watch(view, () => (drawing.value = false))
async function onDraw() {
  if (!myTurn.value || drawing.value) return
  drawing.value = true
  // A rejected draw brings no new view, so undo the lift here.
  if (!(await room.send({ type: 'draw' }))) drawing.value = false
}

// --- answering --------------------------------------------------------------------
const prompt = computed(() => (view.value?.prompt ? fromRoomPrompt(view.value.prompt, props.vocabulary) : null))
const choices = computed(() =>
  prompt.value && props.settings.answerModes.includes('choice') ? buildChoices(prompt.value, props.vocabulary, 4) : undefined,
)
function onAnswer(r: AnswerResult) {
  room.send({ type: 'answer', answer: r.given })
}

// --- result of the last answer, shown to everyone -----------------------------------
const feedback = computed(() => {
  const ev = view.value?.lastEvent
  const v = view.value
  if (!ev || !v || v.phase !== 'draw') return null
  const who = nameAt(ev.seat)
  if (ev.kind === 'correct')
    return { tone: 'good', text: ev.seat === v.you ? gt('room.youKeep') : gt('room.someoneKeeps', { name: who }) }
  if (ev.kind === 'wrong') return { tone: 'bad', text: t('answer.wrong', { expected: ev.expected }) }
  if (ev.kind === 'skip') return { tone: 'info', text: gt('room.skipped', { name: who }) }
  return null
})

// --- time limit -------------------------------------------------------------------
const nowMs = ref(Date.now())
const clock = setInterval(() => (nowMs.value = Date.now()), 500)
onBeforeUnmount(() => clearInterval(clock))
const secondsLeft = computed(() => (view.value?.endsAt ? Math.max(0, Math.ceil((view.value.endsAt - nowMs.value) / 1000)) : null))
const timeLabel = computed(() => {
  const s = secondsLeft.value ?? 0
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
})
// When the time is up, the host's device tells the server (it verifies the clock).
let timeUpSent = false
watch(secondsLeft, (s) => {
  if (s === 0 && isHost.value && !timeUpSent && view.value && view.value.phase !== 'finished') {
    timeUpSent = true
    room.send({ type: 'timeUp' })
  }
})

// --- results --------------------------------------------------------------------
const ranking = computed(() =>
  (view.value?.players ?? [])
    .map((p, i) => ({ ...p, seat: i }))
    .sort((a, b) => b.sticks - a.sticks),
)
const winnerText = computed(() => {
  const v = view.value
  if (!v) return ''
  if (v.winners.length > 1) return gt('tie', { names: v.winners.map(nameAt).join(' & ') })
  return v.winners[0] === v.you ? gt('room.youWin') : gt('winsTrophy', { name: nameAt(v.winners[0]) })
})

function rematch() {
  timeUpSent = false
  room.send({ type: 'rematch' })
}

function leave() {
  room.leave()
  router.replace({ query: {} })
}
</script>

<template>
  <GameShell :title="gt('name')" @restart="leave">
    <template #status>
      <template v-if="view && !inLobby && view.phase !== 'finished'">
        <span v-if="secondsLeft !== null" class="clock" :class="{ low: secondsLeft <= 30 }">⏱ {{ timeLabel }}</span>
        <span :title="gt('wordSticks')">🥢 {{ view.wordsLeft }}</span>
      </template>
    </template>

    <div v-if="room.connection.value === 'gone'" class="card notice">
      <h2>{{ t('game.unavailable') }}</h2>
      <p class="muted">{{ t('game.unavailableText') }}</p>
      <button class="btn btn-primary" type="button" @click="leave">{{ t('game.newGame') }}</button>
    </div>

    <RoomLobby
      v-else-if="inLobby"
      :room="room as Room<unknown>"
      :title="gt('name')"
      icon="💥"
      :intro="gt('room.intro')"
      :min-players="2"
      :max-players="6"
      :players="view?.players.map((p) => p.name)"
      @start="room.send({ type: 'start' })"
    />

    <template v-else-if="view">
      <RoomPlayers
        :players="view.players.map((p) => ({ name: p.name, score: p.sticks }))"
        :turn="view.turn"
        :you="view.you"
        :online="room.envelope.value?.online ?? []"
        :finished="view.phase === 'finished'"
        :score-label="gt('room.sticks')"
        @skip="room.send({ type: 'skip' })"
      />
      <div v-if="room.error.value" class="alert" role="alert">{{ room.error.value }}</div>

      <ResultScreen
        v-if="view.phase === 'finished'"
        :title="winnerText"
        :subtitle="view.lastEvent?.kind === 'timeup' ? gt('timeUp') : gt('cupEmpty')"
        @again="rematch"
      >
        <ol class="ranking">
          <li v-for="p in ranking" :key="p.seat" :style="{ '--c': seatColor(p.seat) }">
            <i />
            <span class="rname">{{ nameAt(p.seat) }}</span>
            <span class="muted small">{{ p.kabooms }}× 💥</span>
            <strong>{{ p.sticks }} 🥢</strong>
          </li>
        </ol>
      </ResultScreen>

      <template v-else>
        <div class="turn" :class="{ mine: myTurn }" :style="{ '--c': seatColor(view.turn) }">
          <i class="turn-dot" />
          <span v-if="view.phase === 'draw'">{{ myTurn ? gt('room.yourDraw') : gt('room.someoneDraws', { name: nameAt(view.turn) }) }}</span>
          <span v-else-if="view.phase === 'answer'">{{ myTurn ? gt('room.yourTranslate') : gt('room.someoneTranslates', { name: nameAt(view.turn) }) }}</span>
          <span v-else>{{ myTurn ? gt('room.youKaboom') : gt('teamKaboom', { name: nameAt(view.turn) }) }}</span>
        </div>

        <div class="stage">
          <Transition name="swap" mode="out-in">
            <div v-if="view.phase === 'draw'" key="draw" class="cup-area">
              <Cup :count="view.cupCount" :capacity="view.capacity" :drawing="drawing" :disabled="!myTurn || drawing" @draw="onDraw" />
              <p class="muted small">{{ gt('inCup', { n: view.cupCount }, view.cupCount) }}</p>
              <Transition name="fade">
                <p v-if="feedback" :key="view.lastEvent?.seq" class="feedback" :class="feedback.tone">{{ feedback.text }}</p>
              </Transition>
            </div>

            <div v-else-if="view.phase === 'answer' && prompt" :key="`q-${view.lastEvent?.seq}`" class="question">
              <PromptCard :prompt="prompt" class="stick-card" />
              <AnswerInput v-if="myTurn" :prompt="prompt" :modes="settings.answerModes" :choices="choices" deferred @answer="onAnswer" />
            </div>

            <div v-else-if="view.phase === 'kaboom'" key="boom" class="kaboom" role="alert">
              <KaboomBlast />
              <p class="boom-msg">
                <template v-if="(view.lastEvent?.lost ?? 0) > 0">
                  {{
                    myTurn
                      ? gt('room.youLost', { n: view.lastEvent?.lost }, view.lastEvent?.lost ?? 0)
                      : gt('teamLost', { name: nameAt(view.turn), n: view.lastEvent?.lost }, view.lastEvent?.lost ?? 0)
                  }}
                </template>
                <template v-else>{{ gt('room.lucky') }}</template>
              </p>
              <button v-if="myTurn || isHost" class="btn btn-primary btn-lg" type="button" @click="room.send({ type: 'continue' })">
                {{ t('game.next') }}
              </button>
            </div>
          </Transition>
        </div>
      </template>
    </template>
  </GameShell>
</template>

<style scoped>
.notice {
  max-width: 440px;
  margin: 24px auto;
  text-align: center;
}
.turn {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  padding: 10px 14px;
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--c) 12%, var(--surface));
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
  min-height: 320px;
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
.feedback {
  margin: 8px 0 0;
  padding: 8px 14px;
  border-radius: var(--radius-sm);
  font-weight: 700;
}
.feedback.good {
  background: var(--good-soft);
  color: var(--good-ink);
}
.feedback.bad {
  background: var(--bad-soft);
  color: var(--bad-ink);
}
.feedback.info {
  background: var(--surface-2);
  color: var(--muted);
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
  border: 3px solid var(--table-edge);
  background: repeating-linear-gradient(90deg, var(--table-a), var(--table-a) 18px, var(--table-b) 18px, var(--table-b) 20px);
  animation: rise-in 0.4s var(--ease-bounce);
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
.rname {
  flex: 1;
}
@keyframes rise-in {
  from {
    transform: translateY(40px) scale(0.9);
    opacity: 0;
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
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
