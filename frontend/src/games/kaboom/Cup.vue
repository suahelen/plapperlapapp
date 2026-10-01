<script setup lang="ts">
import { useGameT } from '../i18n'
import { computed, ref, watch } from 'vue'

/**
 * The stick cup. The number of drawn sticks reflects how full the cup is
 * (count relative to capacity), and each pull lifts a random stick.
 */
const props = defineProps<{ count: number; capacity: number; drawing: boolean; disabled: boolean }>()
const gt = useGameT('kaboom')
const emit = defineEmits<{ draw: [] }>()

const MAX_VISIBLE = 16
const STICK_COLORS = ['var(--deco-1)', 'var(--deco-3)', 'var(--deco-4)', 'var(--deco-2)', 'var(--deco-5)', 'var(--deco-8)']

const visible = computed(() => {
  if (props.count <= 0) return 0
  const ratio = props.count / Math.max(props.capacity, props.count)
  return Math.max(1, Math.round(ratio * MAX_VISIBLE))
})

// Stick layout is fixed per slot, so sticks don't jump when the level changes.
const slots = Array.from({ length: MAX_VISIBLE }, (_, i) => {
  const t = (i * 7) % MAX_VISIBLE / (MAX_VISIBLE - 1) // spread slots across the cup width
  return {
    x: 60 + (t - 0.5) * 56,
    rot: (t - 0.5) * 22,
    h: 66 + ((i * 37) % 26),
    color: STICK_COLORS[i % STICK_COLORS.length],
  }
})
const sticks = computed(() => slots.slice(0, visible.value))

// Pick a new random stick to pull each time drawing starts.
const liftIndex = ref(-1)
watch(
  () => props.drawing,
  (drawing) => {
    liftIndex.value = drawing ? Math.floor(Math.random() * visible.value) : -1
  },
)
</script>

<template>
  <button
    class="cup-btn"
    type="button"
    :disabled="disabled || count === 0"
    :class="{ drawing }"
    :aria-label="gt('cup.draw')"
    @click="emit('draw')"
  >
    <svg viewBox="0 0 120 150" aria-hidden="true">
      <g class="sticks">
        <g v-for="(s, i) in sticks" :key="i" :transform="`rotate(${s.rot} ${s.x} 120)`">
          <rect
            :x="s.x - 3"
            :y="118 - s.h"
            width="6"
            :height="s.h"
            rx="3"
            :fill="s.color"
            :class="{ lift: i === liftIndex }"
          />
        </g>
      </g>
      <path d="M22 62 L98 62 L90 142 Q89 146 85 146 L35 146 Q31 146 30 142 Z" class="cup" />
      <path d="M22 62 L98 62 L97 72 L23 72 Z" class="rim" />
      <path d="M34 82 L38 136" class="shine" />
    </svg>
    <span class="label">{{ count === 0 ? gt('cup.empty') : gt('cup.go') }}</span>
  </button>
</template>

<style scoped>
.cup-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.cup-btn:disabled {
  cursor: default;
}
.cup-btn svg {
  width: clamp(130px, 34vw, 190px);
  overflow: visible;
  filter: drop-shadow(0 8px 10px var(--drop-shadow));
  transition: transform 0.15s var(--ease-bounce);
}
.cup-btn:not(:disabled):hover svg {
  transform: rotate(-3deg) scale(1.03);
}
.cup-btn:not(:disabled):active svg {
  transform: scale(0.96);
}
.cup {
  fill: var(--cup);
}
.rim {
  fill: var(--cup-rim);
}
.shine {
  stroke: color-mix(in srgb, var(--on-color) 35%, transparent);
  stroke-width: 5;
  stroke-linecap: round;
}
.lift {
  animation: lift 0.7s ease-in forwards;
}
@keyframes lift {
  40% {
    transform: translateY(-40px);
    opacity: 1;
  }
  to {
    transform: translateY(-110px);
    opacity: 0;
  }
}
.label {
  font: 800 1.2rem var(--font-display);
  color: var(--cup-rim);
}
.cup-btn:disabled .label {
  color: var(--muted);
}
</style>
