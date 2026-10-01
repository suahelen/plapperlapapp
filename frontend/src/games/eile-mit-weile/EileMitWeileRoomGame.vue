<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useGameT } from '../i18n'
import { playerName } from '../shared/room/names'
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { GameProps } from '../types'
import type { BoardConfig, EileMitWeileSettings, PlayerColor } from './types'
import type { EileRoomView } from './roomTypes'
import { movePath } from './logic'
import Board, { type PawnView } from './Board.vue'
import Die from './Die.vue'
import GameShell from '../shared/ui/GameShell.vue'
import ResultScreen from '../shared/ui/ResultScreen.vue'
import PromptCard from '../shared/answer/PromptCard.vue'
import AnswerInput from '../shared/answer/AnswerInput.vue'
import { buildChoices, type AnswerResult } from '../shared/answer/prompt'
import RoomLobby from '../shared/room/RoomLobby.vue'
import RoomPlayers from '../shared/room/RoomPlayers.vue'
import { useRoom, type Room } from '../shared/room/useRoom'
import { fromRoomPrompt } from '../shared/room/roomPrompt'
import { useTimers } from '../shared/timing'

const props = defineProps<GameProps<EileMitWeileSettings>>()
const gt = useGameT('eile-mit-weile')
const { t } = useI18n()
const nameAt = (seat: number) => playerName(view.value?.players[seat]?.name, seat)
const route = useRoute()
const router = useRouter()
const { wait } = useTimers()

const COLOR_VAR: Record<PlayerColor, string> = {
  red: 'var(--player-red)',
  blue: 'var(--player-blue)',
  green: 'var(--player-green)',
  yellow: 'var(--player-yellow)',
}

const room = useRoom<EileRoomView>(String(route.params.publicId), 'eile-mit-weile')
const view = computed(() => room.envelope.value?.view ?? null)
const inLobby = computed(() => !view.value || view.value.phase === 'lobby')
const myTurn = computed(() => !!view.value && view.value.turn === view.value.you)
const current = computed(() => view.value?.players[view.value.turn])

const config = computed<BoardConfig>(() => ({
  trackLength: view.value?.trackLength ?? 48,
  homeLength: view.value?.homeLength ?? 4,
  pawnsPerPlayer: view.value?.pawnsPerPlayer ?? 1,
  sixRollsAgain: view.value?.sixRollsAgain ?? true,
}))

// --- animations driven by server events -------------------------------------------
const rolling = ref(false)
const anim = shallowRef<{ player: number; pawn: number; progress: number; captured: { player: number; pawn: number; from: number }[] } | null>(null)
// Sequence number of the last event already shown; null until the first view arrives.
// That first view is the baseline: its event (if any) happened before we connected and
// is not replayed. Keying this on the first *event* instead would swallow the first roll
// of a new game (no event yet) and leave the die spinning forever.
let lastSeq: number | null = null

watch(view, async (v) => {
  if (!v) return
  const ev = v.lastEvent
  if (lastSeq === null) {
    lastSeq = ev?.seq ?? 0
    rolling.value = false
    return
  }
  if (!ev || ev.seq === lastSeq) {
    // No new event, but the game moved on (e.g. updates were merged): stop a local spin.
    if (v.phase !== 'roll' && !anim.value) rolling.value = false
    return
  }
  lastSeq = ev.seq
  if (ev.kind === 'roll') {
    rolling.value = true
    await wait(600)
    rolling.value = false
    return
  }
  rolling.value = false
  if (ev.kind === 'move') {
    anim.value = { player: ev.seat, pawn: ev.pawn, progress: ev.from, captured: ev.captured ?? [] }
    for (const step of movePath(ev.from, ev.to)) {
      await wait(210)
      if (anim.value) anim.value = { ...anim.value, progress: step }
    }
    if (ev.captured?.length) await wait(350)
    anim.value = null
  }
})

const pawnViews = computed<PawnView[]>(() => {
  const v = view.value
  if (!v) return []
  return v.players.flatMap((pl, pi) =>
    pl.pawns.map((progress, i) => {
      let shown = progress
      const a = anim.value
      if (a) {
        if (a.player === pi && a.pawn === i) shown = a.progress
        const cap = a.captured.find((c) => c.player === pi && c.pawn === i)
        if (cap) shown = cap.from
      }
      return {
        player: pi,
        pawn: i,
        color: pl.color,
        progress: shown,
        movable: myTurn.value && v.phase === 'choose-pawn' && !anim.value && pi === v.turn && v.movable.includes(i),
      }
    }),
  )
})

// --- actions ------------------------------------------------------------------------
async function roll() {
  if (!myTurn.value || room.busy.value) return
  rolling.value = true // spin at once on this screen; the value arrives from the server
  // A rejected roll brings no new view, so stop the spin here.
  if (!(await room.send({ type: 'roll' }))) rolling.value = false
}

const prompt = computed(() => (view.value?.prompt ? fromRoomPrompt(view.value.prompt, props.vocabulary) : null))
const choices = computed(() =>
  prompt.value && props.settings.answerModes.includes('choice') ? buildChoices(prompt.value, props.vocabulary, 4) : undefined,
)
function onAnswer(r: AnswerResult) {
  room.send({ type: 'answer', answer: r.given })
}
function onPick(pawn: number) {
  room.send({ type: 'choose', pawn })
}

const status = computed(() => {
  const v = view.value
  if (!v) return ''
  const who = nameAt(v.turn)
  if (anim.value) return myTurn.value ? gt('room.youMove') : gt('status.moving', { name: who })
  switch (v.phase) {
    case 'roll':
      return myTurn.value ? gt('room.yourRoll') : gt('room.someoneRolls', { name: who })
    case 'answer':
      return myTurn.value ? gt('status.translate', { n: v.roll }, v.roll) : gt('room.someoneTranslates', { name: who })
    case 'choose-pawn':
      return myTurn.value ? gt('status.choosePawn') : gt('room.someoneChooses', { name: who })
    default:
      return ''
  }
})

// Show the correct answer to everyone after a wrong answer.
const wrong = computed(() => {
  const ev = view.value?.lastEvent
  return ev?.kind === 'wrong' && view.value?.phase === 'roll' ? ev : null
})

const winner = computed(() => (view.value && view.value.winner >= 0 ? view.value.players[view.value.winner] : null))

function leave() {
  room.leave()
  lastSeq = null
  rolling.value = false
  anim.value = null
  router.replace({ query: {} })
}
</script>

<template>
  <GameShell :title="gt('name')" @restart="leave">
    <div v-if="room.connection.value === 'gone'" class="card notice">
      <h2>{{ t('game.unavailable') }}</h2>
      <p class="muted">{{ t('game.unavailableText') }}</p>
      <button class="btn btn-primary" type="button" @click="leave">{{ t('game.newGame') }}</button>
    </div>

    <RoomLobby
      v-else-if="inLobby"
      :room="room as Room<unknown>"
      :title="gt('name')"
      icon="🎲"
      :intro="gt('room.intro')"
      :min-players="2"
      :max-players="4"
      :players="view?.players.map((p) => p.name)"
      @start="room.send({ type: 'start' })"
    />

    <template v-else-if="view">
      <RoomPlayers
        :players="view.players.map((p) => ({ name: p.name, score: p.correct }))"
        :turn="view.turn"
        :you="view.you"
        :online="room.envelope.value?.online ?? []"
        :finished="view.phase === 'finished'"
        :colors="view.players.map((p) => COLOR_VAR[p.color])"
        :score-label="t('game.correctAnswers')"
        @skip="room.send({ type: 'skip' })"
      />
      <div v-if="room.error.value" class="alert" role="alert">{{ room.error.value }}</div>

      <ResultScreen
        v-if="view.phase === 'finished' && !anim"
        :title="winner && view.winner === view.you ? t('game.youWin') : t('game.someoneWins', { name: nameAt(view.winner) })"
        :subtitle="gt('afterRounds', { n: view.round }, view.round)"
        @again="room.send({ type: 'rematch' })"
      >
        <ul class="stats">
          <li v-for="(p, i) in view.players" :key="i" :style="{ '--c': COLOR_VAR[p.color] }">
            <i />
            <span>{{ nameAt(i) }} <small class="muted">({{ gt(`colors.${p.color}`) }})</small></span>
            <strong>{{ t('game.rightCount', { correct: p.correct, answered: p.answered }) }}</strong>
          </li>
        </ul>
      </ResultScreen>

      <div v-else class="play">
        <div class="turn" :style="{ '--c': current ? COLOR_VAR[current.color] : 'var(--line)' }">
          <i class="turn-dot" />
          <span>{{ status }}</span>
        </div>

        <Board
          :config="config"
          :pawns="pawnViews"
          :active-color="current?.color ?? 'red'"
          :used-colors="view.players.map((p) => p.color)"
          @pick="onPick"
        />

        <div class="panel">
          <p v-if="wrong" class="wrong" role="status">
            {{ wrong.seat === view.you ? t('game.wrongAnswer') : t('game.someoneWrong', { name: nameAt(wrong.seat) }) }}
            <i18n-t keypath="game.correctWas" tag="span">
              <template #expected><strong>{{ wrong.expected }}</strong></template>
            </i18n-t>
          </p>

          <div v-if="view.phase === 'roll' || rolling" class="roll-row">
            <Die :value="view.roll || null" :rolling="rolling" :color="current ? COLOR_VAR[current.color] : undefined" />
            <button v-if="myTurn" class="btn btn-primary btn-lg" type="button" :disabled="rolling || !!anim || room.busy.value" @click="roll">
              {{ gt('roll') }}
            </button>
          </div>

          <div v-else-if="view.phase === 'answer' && prompt" :key="view.lastEvent?.seq" class="answer-box">
            <div class="answer-head">
              <Die :value="view.roll" :rolling="false" :color="current ? COLOR_VAR[current.color] : undefined" class="mini-die" />
              <PromptCard :prompt="prompt" compact class="grow" />
            </div>
            <AnswerInput v-if="myTurn" :prompt="prompt" :modes="settings.answerModes" :choices="choices" deferred @answer="onAnswer" />
          </div>
        </div>
      </div>
    </template>
  </GameShell>
</template>

<style scoped>
.notice {
  max-width: 440px;
  margin: 24px auto;
  text-align: center;
}
.play {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 12px;
}
.play :deep(.board) {
  max-width: min(560px, 56dvh);
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
.panel {
  min-height: 110px;
}
.wrong {
  margin: 0 0 8px;
  padding: 8px 14px;
  border-radius: var(--radius-sm);
  background: var(--bad-soft);
  color: var(--bad-ink);
  font-weight: 600;
  text-align: center;
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
.stats i {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--c);
}
.stats strong {
  margin-left: auto;
}
</style>
