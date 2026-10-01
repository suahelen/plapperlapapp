<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{ value: number | null; rolling: boolean; color?: string }>()

// While rolling, flicker through random faces.
const face = ref(props.value ?? 1)
let timer: ReturnType<typeof setInterval> | undefined

watch(
  () => props.rolling,
  (rolling) => {
    clearInterval(timer)
    if (rolling) {
      timer = setInterval(() => (face.value = 1 + Math.floor(Math.random() * 6)), 70)
    } else if (props.value) {
      face.value = props.value
    }
  },
)
watch(
  () => props.value,
  (v) => {
    if (v && !props.rolling) face.value = v
  },
)
onBeforeUnmount(() => clearInterval(timer))

// Pip positions on a 3×3 grid for each face.
const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [
    [0, 0],
    [2, 2],
  ],
  3: [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  4: [
    [0, 0],
    [2, 0],
    [0, 2],
    [2, 2],
  ],
  5: [
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 2],
    [2, 2],
  ],
  6: [
    [0, 0],
    [2, 0],
    [0, 1],
    [2, 1],
    [0, 2],
    [2, 2],
  ],
}
</script>

<template>
  <div class="die" :class="{ rolling }" :style="{ '--die-accent': color ?? 'var(--ink)' }" :aria-label="value ? `Gewürfelt: ${value}` : 'Würfel'" role="img">
    <svg viewBox="0 0 60 60">
      <rect x="3" y="3" width="54" height="54" rx="12" class="face" />
      <circle v-for="([cx, cy], i) in PIPS[face]" :key="i" :cx="15 + cx * 15" :cy="15 + cy * 15" r="5.2" class="pip" />
    </svg>
  </div>
</template>

<style scoped>
.die {
  width: 72px;
  height: 72px;
  filter: drop-shadow(0 4px 0 var(--drop-shadow));
}
.die svg {
  width: 100%;
  height: 100%;
}
.face {
  fill: var(--die-face);
  stroke: var(--line);
  stroke-width: 2;
}
.pip {
  fill: var(--die-accent);
}
.rolling {
  animation: tumble 0.6s ease-in-out;
}
@keyframes tumble {
  0% {
    transform: rotate(0) scale(1);
  }
  30% {
    transform: rotate(-25deg) scale(1.1) translateY(-8px);
  }
  60% {
    transform: rotate(20deg) scale(1.05);
  }
  100% {
    transform: rotate(0) scale(1);
  }
}
</style>
