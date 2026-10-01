<script setup lang="ts">
import { useGameT } from '../i18n'
import { computed } from 'vue'

/** Card grid with flip animation, shared by single-device and multi-device Memory. */
export interface BoardCard {
  text?: string
  side?: 'source' | 'target' | string
  up: boolean
  matched: boolean
  /** Colour of the player who found the pair (multi-device mode). */
  ownerColor?: string
}

const props = defineProps<{ cards: BoardCard[]; disabled?: boolean }>()
const gt = useGameT('memory')
const emit = defineEmits<{ flip: [index: number] }>()

const columns = computed(() => {
  const n = props.cards.length
  return n <= 12 ? 4 : n <= 20 ? 5 : 6
})
</script>

<template>
  <div class="grid" :style="{ '--cols': columns }">
    <button
      v-for="(card, i) in cards"
      :key="i"
      type="button"
      class="card-btn"
      :class="{ up: card.up || card.matched, matched: card.matched, owned: !!card.ownerColor }"
      :style="card.ownerColor ? { '--owner': card.ownerColor } : undefined"
      :disabled="disabled || card.up || card.matched"
      :aria-label="card.up || card.matched ? card.text : gt('card', { n: i + 1 })"
      @click="emit('flip', i)"
    >
      <span class="inner">
        <span class="face back" aria-hidden="true">?</span>
        <span class="face front" :class="card.side">{{ card.text }}</span>
      </span>
    </button>
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(var(--cols), 1fr);
  gap: 10px;
  max-width: 680px;
  margin: 8px auto;
}
@media (max-width: 520px) {
  .grid {
    grid-template-columns: repeat(min(var(--cols), 4), 1fr);
    gap: 8px;
  }
}
.card-btn {
  aspect-ratio: 3 / 4;
  padding: 0;
  border: none;
  background: none;
  perspective: 800px;
  cursor: pointer;
}
.card-btn:disabled {
  cursor: default;
}
.inner {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  transition: transform 0.35s ease;
  transform-style: preserve-3d;
}
.up .inner {
  transform: rotateY(180deg);
}
.face {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 6px;
  border-radius: var(--radius);
  backface-visibility: hidden;
  font: 800 clamp(0.8rem, 2.8vw, 1.05rem) var(--font-display);
  overflow-wrap: anywhere;
  text-align: center;
  line-height: 1.15;
}
.back {
  background: repeating-linear-gradient(45deg, var(--primary), var(--primary) 8px, var(--primary-strong) 8px, var(--primary-strong) 16px);
  color: var(--on-color);
  font-size: 1.8rem;
  box-shadow: 0 3px 0 var(--primary-strong);
}
.front {
  transform: rotateY(180deg);
  background: var(--surface-bright);
  border: 2px solid var(--line);
  box-shadow: 0 3px 0 var(--line);
}
.front.target {
  background: var(--card-front);
}
.matched .front {
  border-color: var(--good);
  background: var(--good-soft);
  color: var(--good-ink);
  box-shadow: 0 3px 0 var(--good);
}
.owned .front {
  border-color: var(--owner);
  background: color-mix(in srgb, var(--owner) 14%, var(--surface-bright));
  color: var(--ink);
  box-shadow: 0 3px 0 var(--owner);
}
.matched {
  animation: pulse 0.4s ease;
}
@keyframes pulse {
  50% {
    transform: scale(1.06);
  }
}
</style>
