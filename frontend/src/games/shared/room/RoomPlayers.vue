<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { playerName } from './names'
import { computed } from 'vue'
import { seatColor } from './colors'

/**
 * Scoreboard for room games: whose turn it is, scores and connection status.
 * The host (seat 0) can skip the current player when their device is offline.
 */
const props = defineProps<{
  players: { name: string; score?: number }[]
  turn: number
  you: number
  online: boolean[]
  finished?: boolean
  scoreLabel?: string
  /** Custom colour per seat (e.g. Eile mit Weile pawn colours). */
  colors?: string[]
}>()
const emit = defineEmits<{ skip: [] }>()
const { t } = useI18n()

const colorOf = (i: number) => props.colors?.[i] ?? seatColor(i)
const canSkip = computed(
  () => !props.finished && props.you === 0 && props.turn !== 0 && props.online[props.turn] === false,
)
</script>

<template>
  <div class="players">
    <div
      v-for="(p, i) in players"
      :key="i"
      class="player"
      :class="{ active: !finished && i === turn, offline: online[i] === false }"
      :style="{ '--c': colorOf(i) }"
    >
      <i class="dot" />
      <span class="name">{{ playerName(p.name, i) }}<small v-if="i === you"> {{ t('room.you') }}</small></span>
      <strong v-if="p.score !== undefined" class="score" :title="scoreLabel">{{ p.score }}</strong>
      <span v-if="online[i] === false" class="off" :title="t('room.disconnected')">⚠︎</span>
    </div>
  </div>
  <div v-if="canSkip" class="skip">
    <span>{{ t('room.notConnected', { name: playerName(players[turn]?.name, turn) }) }}</span>
    <button class="btn btn-ghost" type="button" @click="emit('skip')">{{ t('room.skip') }}</button>
  </div>
</template>

<style scoped>
.players {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
}
.player {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: var(--radius);
  background: var(--surface);
  border: 2px solid var(--line);
  min-width: 0;
  transition:
    transform 0.2s var(--ease-bounce),
    border-color 0.2s;
}
.player.active {
  border-color: var(--c);
  background: color-mix(in srgb, var(--c) 10%, var(--surface));
  transform: translateY(-2px);
}
.player.offline {
  opacity: 0.6;
}
.dot {
  flex: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--c);
}
.name {
  flex: 1;
  min-width: 0;
  font-weight: 700;
  font-size: 0.9rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.name small {
  font-weight: 400;
  color: var(--muted);
}
.score {
  font: 800 1.15rem var(--font-display);
}
.off {
  color: var(--bad);
}
.skip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  background: var(--bad-soft);
  color: var(--bad-ink);
  font-weight: 600;
}
</style>
