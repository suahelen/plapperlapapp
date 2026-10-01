<script setup lang="ts">
import { useGameT } from '../i18n'
import { computed } from 'vue'
import { COLORS, isSafeField, startFieldOf } from './logic'
import { fieldRadius, homePoint, pawnPoint, stallCenter, trackPoint, type Point } from './board'
import type { BoardConfig, PlayerColor } from './types'

export interface PawnView {
  player: number
  pawn: number
  color: PlayerColor
  progress: number
  movable: boolean
}

const props = defineProps<{
  config: BoardConfig
  pawns: PawnView[]
  activeColor: PlayerColor
  usedColors: PlayerColor[]
}>()
const gt = useGameT('eile-mit-weile')
const emit = defineEmits<{ pick: [pawn: number] }>()

const COLOR_VAR: Record<PlayerColor, string> = {
  red: 'var(--player-red)',
  blue: 'var(--player-blue)',
  green: 'var(--player-green)',
  yellow: 'var(--player-yellow)',
}

const r = computed(() => fieldRadius(props.config))

const fields = computed(() =>
  Array.from({ length: props.config.trackLength }, (_, i) => {
    const startOf = COLORS.find((col) => startFieldOf(col, props.config) === i)
    return { i, ...trackPoint(i, props.config), safe: isSafeField(i, props.config), startOf }
  }),
)

const homes = computed(() =>
  COLORS.map((color) => ({
    color,
    points: Array.from({ length: props.config.homeLength }, (_, k) => homePoint(color, k, props.config)),
  })),
)

// Pawn positions, nudged apart when several pawns share a spot.
const pawnPositions = computed(() => {
  const groups = new Map<string, number>()
  return props.pawns.map((p) => {
    const pt: Point = pawnPoint(p.color, p.pawn, p.progress, props.config)
    const key = `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`
    const n = groups.get(key) ?? 0
    groups.set(key, n + 1)
    const offset = n === 0 ? { x: 0, y: 0 } : { x: ((n % 2) * 2 - 1) * 1.6, y: -1.4 * Math.ceil(n / 2) }
    return { ...p, x: pt.x + offset.x, y: pt.y + offset.y }
  })
})

function pick(p: PawnView) {
  if (p.movable) emit('pick', p.pawn)
}
</script>

<template>
  <svg class="board" viewBox="0 0 100 100" role="img" :aria-label="gt('boardLabel')">
    <defs>
      <radialGradient id="pawn-shine" cx="35%" cy="30%" r="70%">
        <stop offset="0%" stop-color="var(--surface-bright)" stop-opacity="0.75" />
        <stop offset="45%" stop-color="var(--surface-bright)" stop-opacity="0" />
      </radialGradient>
      <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="0.5" stdDeviation="0.5" flood-color="var(--board-shadow)" flood-opacity="0.35" />
      </filter>
    </defs>

    <rect x="1" y="1" width="98" height="98" rx="8" class="table" />

    <!-- stalls -->
    <g v-for="color in COLORS" :key="`stall-${color}`" :opacity="usedColors.includes(color) ? 1 : 0.35">
      <rect
        :x="stallCenter(color).x - 12"
        :y="stallCenter(color).y - 12"
        width="24"
        height="24"
        rx="6"
        :fill="COLOR_VAR[color]"
        fill-opacity="0.16"
        :stroke="COLOR_VAR[color]"
        stroke-opacity="0.45"
        stroke-width="0.5"
      />
      <circle
        v-for="k in 4"
        :key="k"
        :cx="stallCenter(color).x + (k % 2 ? -5 : 5)"
        :cy="stallCenter(color).y + (k <= 2 ? -5 : 5)"
        r="2.8"
        fill="var(--board-field)"
        fill-opacity="0.8"
      />
    </g>

    <!-- track -->
    <g v-for="f in fields" :key="f.i">
      <circle
        :cx="f.x"
        :cy="f.y"
        :r="r"
        class="field"
        :style="f.startOf ? { fill: COLOR_VAR[f.startOf], fillOpacity: 0.85 } : undefined"
      />
      <!-- Bänkli: a small bench marks safe fields -->
      <g v-if="f.safe" class="bench" :transform="`translate(${f.x} ${f.y})`">
        <rect :x="-r * 0.55" :y="-r * 0.2" :width="r * 1.1" :height="r * 0.28" rx="0.2" />
        <rect :x="-r * 0.45" :y="-r * 0.2" :width="r * 0.14" :height="r * 0.6" />
        <rect :x="r * 0.31" :y="-r * 0.2" :width="r * 0.14" :height="r * 0.6" />
      </g>
    </g>

    <!-- home stretches -->
    <g v-for="h in homes" :key="`home-${h.color}`" :opacity="usedColors.includes(h.color) ? 1 : 0.35">
      <circle
        v-for="(pt, k) in h.points"
        :key="k"
        :cx="pt.x"
        :cy="pt.y"
        :r="k === h.points.length - 1 ? r * 1.15 : r * 0.9"
        :fill="COLOR_VAR[h.color]"
        :fill-opacity="k === h.points.length - 1 ? 0.9 : 0.35"
        :stroke="COLOR_VAR[h.color]"
        stroke-width="0.5"
      />
    </g>

    <!-- centre -->
    <circle cx="50" cy="50" r="5" class="centre" />
    <text x="50" y="51.6" class="centre-star" text-anchor="middle">★</text>

    <!-- pawns -->
    <g
      v-for="p in pawnPositions"
      :key="`${p.player}-${p.pawn}`"
      class="pawn"
      :class="{ movable: p.movable, active: p.color === activeColor }"
      :style="{ transform: `translate(${p.x}px, ${p.y}px)` }"
      :role="p.movable ? 'button' : undefined"
      :tabindex="p.movable ? 0 : undefined"
      :aria-label="p.movable ? `Figur ${p.pawn + 1} bewegen` : undefined"
      @click="pick(p)"
      @keydown.enter.prevent="pick(p)"
      @keydown.space.prevent="pick(p)"
    >
      <circle v-if="p.movable" r="4.2" class="ring" :stroke="COLOR_VAR[p.color]" />
      <circle r="2.6" :fill="COLOR_VAR[p.color]" stroke="var(--board-field)" stroke-width="0.7" filter="url(#soft)" />
      <circle r="2.6" fill="url(#pawn-shine)" />
    </g>
  </svg>
</template>

<style scoped>
.board {
  display: block;
  width: 100%;
  max-width: 560px;
  margin: 0 auto;
  aspect-ratio: 1;
  user-select: none;
}
.table {
  fill: var(--board-bg);
  stroke: var(--board-edge);
  stroke-width: 0.6;
}
.field {
  fill: var(--board-field);
  stroke: var(--board-field-edge);
  stroke-width: 0.45;
}
.bench rect {
  fill: var(--board-bench);
  opacity: 0.75;
}
.centre {
  fill: var(--board-field);
  stroke: var(--board-field-edge);
  stroke-width: 0.5;
}
.centre-star {
  font-size: 5px;
  fill: var(--player-yellow);
}
.pawn {
  transition: transform 0.2s ease-out;
}
.pawn.movable {
  cursor: pointer;
}
.pawn:focus-visible {
  outline: none;
}
.pawn:focus-visible .ring {
  stroke-width: 1.2;
}
.ring {
  fill: none;
  stroke-width: 0.7;
  animation: pulse 1s ease-in-out infinite;
  transform-origin: center;
  transform-box: fill-box;
}
@keyframes pulse {
  50% {
    transform: scale(1.2);
    opacity: 0.4;
  }
}
</style>
