<script setup lang="ts">
import { useGameT } from '../i18n'
import { useI18n } from 'vue-i18n'
import { playerName } from '../shared/room/names'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { GameProps } from '../types'
import type { MemorySettings } from './types'
import type { MemoryRoomView } from './roomTypes'
import MemoryBoard from './MemoryBoard.vue'
import GameShell from '../shared/ui/GameShell.vue'
import ResultScreen from '../shared/ui/ResultScreen.vue'
import RoomLobby from '../shared/room/RoomLobby.vue'
import RoomPlayers from '../shared/room/RoomPlayers.vue'
import { useRoom, type Room } from '../shared/room/useRoom'
import { seatColor } from '../shared/room/colors'
const gt = useGameT('memory')
const { t } = useI18n()
const nameAt = (seat: number) => playerName(view.value?.players[seat]?.name, seat)

defineProps<GameProps<MemorySettings>>()
const route = useRoute()
const router = useRouter()

const room = useRoom<MemoryRoomView>(String(route.params.publicId), 'memory')
const view = computed(() => room.envelope.value?.view ?? null)
const inLobby = computed(() => !view.value || view.value.phase === 'lobby')
const myTurn = computed(() => view.value?.phase === 'playing' && view.value.turn === view.value.you)

// Flip immediately on this screen; the server's view replaces it a moment later.
const optimistic = ref<number | null>(null)
watch(view, () => (optimistic.value = null))

const cards = computed(() =>
  (view.value?.cards ?? []).map((c, i) => ({
    text: c.text,
    side: c.side,
    matched: c.matched,
    up: c.faceUp || optimistic.value === i,
    ownerColor: c.matched ? seatColor(c.owner) : undefined,
  })),
)

async function onFlip(i: number) {
  if (!myTurn.value || room.busy.value) return
  optimistic.value = i
  // A rejected flip brings no new view, so turn the card back here.
  if (!(await room.send({ type: 'flip', index: i }))) optimistic.value = null
}

const toast = computed(() => {
  const ev = view.value?.lastEvent
  const v = view.value
  if (!ev || !v || v.phase !== 'playing') return null
  if (ev.kind === 'match')
    return { tone: 'good', text: ev.seat === v.you ? gt('room.youFound') : gt('room.someoneFound', { name: nameAt(ev.seat) }) }
  if (ev.kind === 'mismatch') return { tone: 'info', text: gt('room.noPair') }
  if (ev.kind === 'skip') return { tone: 'info', text: gt('room.skipped', { name: nameAt(ev.seat) }) }
  return null
})

const winnerText = computed(() => {
  const v = view.value
  if (!v) return ''
  if (v.winners.length > 1) return gt('room.tie', { names: v.winners.map(nameAt).join(' & ') })
  return v.winners[0] === v.you ? gt('room.youWin') : gt('room.someoneWins', { name: nameAt(v.winners[0]) })
})

function leave() {
  room.leave()
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
      icon="🃏"
      :intro="gt('room.intro')"
      :min-players="2"
      :max-players="4"
      :players="view?.players.map((p) => p.name)"
      @start="room.send({ type: 'start' })"
    />

    <template v-else-if="view">
      <RoomPlayers
        :players="view.players.map((p) => ({ name: p.name, score: p.score }))"
        :turn="view.turn"
        :you="view.you"
        :online="room.envelope.value?.online ?? []"
        :finished="view.phase === 'finished'"
        :score-label="gt('room.pairs')"
        @skip="room.send({ type: 'skip' })"
      />
      <div v-if="room.error.value" class="alert" role="alert">{{ room.error.value }}</div>

      <ResultScreen v-if="view.phase === 'finished'" :title="winnerText" :subtitle="gt('room.allFound')" @again="room.send({ type: 'rematch' })" />

      <template v-else>
        <div class="turn" :class="{ mine: myTurn }" :style="{ '--c': seatColor(view.turn) }">
          <i class="turn-dot" />
          <span>{{ myTurn ? gt('room.yourTurn') : t('game.someonesTurn', { name: nameAt(view.turn) }) }}</span>
          <Transition name="fade">
            <span v-if="toast" :key="view.lastEvent?.seq" class="toast" :class="toast.tone">{{ toast.text }}</span>
          </Transition>
        </div>
        <MemoryBoard :cards="cards" :disabled="!myTurn || room.busy.value" @flip="onFlip" />
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
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  margin: 12px 0 4px;
  padding: 10px 14px;
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--c) 12%, var(--surface));
  border: 1.5px solid color-mix(in srgb, var(--c) 40%, transparent);
  font-weight: 700;
}
.turn-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--c);
}
.toast {
  margin-left: auto;
  font-size: 0.9rem;
}
.toast.good {
  color: var(--good);
}
.toast.info {
  color: var(--muted);
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
