<script setup lang="ts">
import { computed } from 'vue'

/** The gallows and figure. Body parts appear one by one as wrong guesses pile up. */
const props = defineProps<{ wrongGuesses: number; maxMistakes: number }>()

const PARTS = 6
const visibleParts = computed(() => Math.min(PARTS, Math.ceil((PARTS * props.wrongGuesses) / props.maxMistakes)))
</script>

<template>
  <svg viewBox="0 0 120 140" aria-hidden="true" class="gallows">
    <path d="M10 134 H70 M20 134 V10 H80 M80 10 V26" class="frame" />
    <circle v-if="visibleParts >= 1" cx="80" cy="38" r="12" class="figure" />
    <line v-if="visibleParts >= 2" x1="80" y1="50" x2="80" y2="88" class="figure" />
    <line v-if="visibleParts >= 3" x1="80" y1="58" x2="64" y2="74" class="figure" />
    <line v-if="visibleParts >= 4" x1="80" y1="58" x2="96" y2="74" class="figure" />
    <line v-if="visibleParts >= 5" x1="80" y1="88" x2="66" y2="112" class="figure" />
    <line v-if="visibleParts >= 6" x1="80" y1="88" x2="94" y2="112" class="figure" />
  </svg>
</template>

<style scoped>
.gallows {
  width: clamp(110px, 28vw, 150px);
  display: block;
  margin: 0 auto 8px;
}
.frame {
  fill: none;
  stroke: var(--line);
  stroke-width: 4;
  stroke-linecap: round;
}
.figure {
  fill: none;
  stroke: var(--bad);
  stroke-width: 4;
  stroke-linecap: round;
}
circle.figure {
  fill: var(--bad-soft);
}
</style>
