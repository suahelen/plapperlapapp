<script setup lang="ts">
import { useGameT } from '../i18n'
import { computed } from 'vue'
import { SHOT, type CellView, type ShotEvent } from './types'

/**
 * One battleship board. 'own' shows your fleet and the opponent's shots at it;
 * 'target' shows your shots at the opponent (and their ships once sunk).
 */
const props = defineProps<{
  rows: string[]
  cols: string[]
  cells: CellView[][]
  variant: 'own' | 'target'
  ships: [number, number][][] | null
  shots: number[][]
  clickable?: boolean
  selected?: [number, number] | null
  /** Last shot on this board, highlighted with an animation. */
  lastShot?: ShotEvent | null
  compact?: boolean
}>()
const emit = defineEmits<{ pick: [row: number, col: number] }>()
const gt = useGameT('battleship')

const shipCells = computed(() => {
  const set = new Set<string>()
  for (const ship of props.ships ?? []) for (const [r, c] of ship) set.add(`${r},${c}`)
  return set
})

function state(r: number, c: number) {
  const cell = props.cells[r][c]
  if (!cell.usable) return 'blocked'
  const shot = props.shots[r]?.[c] ?? SHOT.none
  if (shot === SHOT.sunk) return 'sunk'
  if (shot === SHOT.hit) return 'hit'
  if (shot === SHOT.miss) return 'miss'
  return shipCells.value.has(`${r},${c}`) ? 'ship' : 'water'
}

function canPick(r: number, c: number) {
  return props.clickable && props.cells[r][c].usable && (props.shots[r]?.[c] ?? 0) === SHOT.none
}

function isSelected(r: number, c: number) {
  return props.selected?.[0] === r && props.selected?.[1] === c
}

function isLast(r: number, c: number) {
  return props.lastShot && props.lastShot.row === r && props.lastShot.col === c && props.lastShot.kind !== 'wrong'
}

function label(r: number, c: number) {
  const s = state(r, c)
  return `${props.rows[r]} · ${props.cols[c]}: ${gt(`cellState.${s}`)}`
}
</script>

<template>
  <div
    class="board"
    :class="[variant, { compact, clickable }]"
    :style="{ '--cols': cols.length }"
    role="grid"
    :aria-label="variant === 'own' ? gt('yourFleet') : gt('oppSea')"
  >
    <div class="corner" />
    <div v-for="col in cols" :key="`c-${col}`" class="head col-head" :title="col">{{ col }}</div>
    <template v-for="(row, r) in rows" :key="`r-${r}`">
      <div class="head row-head" :title="row">{{ row }}</div>
      <button
        v-for="(_, c) in cols"
        :key="`${r}-${c}`"
        type="button"
        class="cell"
        :class="[state(r, c), { pickable: canPick(r, c), selected: isSelected(r, c), last: isLast(r, c) }]"
        :disabled="!canPick(r, c)"
        :aria-label="label(r, c)"
        :title="cells[r][c].question"
        @click="emit('pick', r, c)"
      >
        <span v-if="state(r, c) === 'miss'" class="mark splash" aria-hidden="true" />
        <span v-else-if="state(r, c) === 'hit'" class="mark" aria-hidden="true">🔥</span>
        <span v-else-if="state(r, c) === 'sunk'" class="mark" aria-hidden="true">✕</span>
      </button>
    </template>
  </div>
</template>

<style scoped>
.board {
  display: grid;
  grid-template-columns: minmax(2.2em, max-content) repeat(var(--cols), minmax(0, 1fr));
  gap: 3px;
  width: 100%;
  max-width: 520px;
  margin: 0 auto;
  padding: 8px;
  border-radius: var(--radius);
  background: var(--sea);
  border: 1px solid var(--sea-edge);
}
.board.compact {
  max-width: 320px;
  gap: 2px;
  padding: 6px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  font-size: clamp(0.62rem, 2.2vw, 0.8rem);
  font-weight: 700;
  color: var(--sea-label);
  line-height: 1.05;
  text-align: center;
  overflow-wrap: anywhere;
  padding: 2px;
}
.row-head {
  justify-content: flex-end;
  text-align: right;
  padding-right: 6px;
}
.compact .head {
  font-size: 0.6rem;
}
.cell {
  position: relative;
  aspect-ratio: 1;
  min-width: 0;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: var(--sea-hover);
  cursor: default;
  display: grid;
  place-items: center;
  transition:
    transform 0.12s ease,
    background 0.2s ease;
}
.compact .cell {
  border-radius: 4px;
}
.cell.water {
  background: linear-gradient(160deg, var(--sea-target-from), var(--sea-target-to));
}
.cell.ship {
  background: linear-gradient(160deg, var(--ship-from), var(--ship-to));
  box-shadow: inset 0 -3px 0 color-mix(in srgb, var(--shade) 18%, transparent);
}
.cell.blocked {
  background: repeating-linear-gradient(45deg, var(--ship-miss-a), var(--ship-miss-a) 4px, var(--ship-miss-b) 4px, var(--ship-miss-b) 8px);
}
.cell.miss {
  background: var(--sea-miss);
}
.cell.hit {
  background: var(--ship-hit);
}
.cell.sunk {
  background: var(--ship-sunk);
  color: var(--on-color);
}
.cell.pickable {
  cursor: pointer;
}
.cell.pickable:hover {
  transform: scale(1.08);
  background: var(--sea-selected);
  z-index: 1;
}
.cell.selected {
  outline: 3px solid var(--primary);
  outline-offset: 1px;
  z-index: 2;
}
.cell.last {
  animation: impact 0.6s ease;
}
.mark {
  font-size: clamp(0.8rem, 3.5vw, 1.2rem);
  font-weight: 800;
  line-height: 1;
}
.compact .mark {
  font-size: 0.75rem;
}
.splash {
  width: 30%;
  height: 30%;
  border-radius: 50%;
  background: var(--surface-bright);
  opacity: 0.85;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--surface-bright) 35%, transparent);
}
@keyframes impact {
  0% {
    transform: scale(1.5);
    filter: brightness(1.6);
  }
  100% {
    transform: scale(1);
  }
}
</style>
