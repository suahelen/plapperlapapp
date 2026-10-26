<script setup lang="ts">
import { useGameT } from '../i18n'

const props = defineProps<{ guessed: string[]; secretKeys: string[]; disabled?: boolean }>()
const gt = useGameT('hangman')
const emit = defineEmits<{ guess: [letter: string] }>()

const LETTERS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(97 + i))

function stateOf(letter: string) {
  if (!props.guessed.includes(letter)) return undefined
  return props.secretKeys.includes(letter) ? 'correct' : 'wrong'
}
</script>

<template>
  <div class="keyboard">
    <button
      v-for="letter in LETTERS"
      :key="letter"
      type="button"
      class="key"
      :class="stateOf(letter)"
      :disabled="disabled || guessed.includes(letter)"
      :aria-label="gt('letter', { letter })"
      @click="emit('guess', letter)"
    >
      {{ letter }}
    </button>
  </div>
</template>

<style scoped>
.keyboard {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(34px, 1fr));
  gap: 6px;
  max-width: 560px;
  margin: 0 auto;
}
.key {
  aspect-ratio: 1;
  border: 2px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-bright);
  font: 800 1rem var(--font-display);
  text-transform: uppercase;
  cursor: pointer;
  box-shadow: 0 3px 0 var(--line);
}
.key:disabled {
  cursor: default;
}
.key.correct {
  border-color: var(--good);
  background: var(--good-soft);
  color: var(--good-ink);
  box-shadow: 0 3px 0 var(--good);
}
.key.wrong {
  border-color: var(--bad);
  background: var(--bad-soft);
  color: var(--bad-ink);
  box-shadow: 0 3px 0 var(--bad);
  opacity: 0.6;
}
</style>
