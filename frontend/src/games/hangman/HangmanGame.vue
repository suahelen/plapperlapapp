<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { useGameT } from '../i18n'
import type { GameProps } from '../types'
import type { HangmanSettings } from './types'
import { buildQuiz, type QuizQuestion } from '../shared/quiz'
import { guessLetter, startRound, type RoundState } from './logic'
import PromptCard from '../shared/answer/PromptCard.vue'
import GameShell from '../shared/ui/GameShell.vue'
import ResultScreen from '../shared/ui/ResultScreen.vue'
import HangmanGallows from './HangmanGallows.vue'
import HangmanKeyboard from './HangmanKeyboard.vue'
import { useTimers } from '../shared/timing'

const props = defineProps<GameProps<HangmanSettings>>()
const gt = useGameT('hangman')
const { t } = useI18n()
const { wait, cancelAll } = useTimers()

const questions = shallowRef<QuizQuestion[]>([])
const index = ref(0)
const score = ref(0)
const round = shallowRef<RoundState | null>(null)
const done = ref(false)

function start() {
  cancelAll()
  questions.value = buildQuiz(props.vocabulary, { count: props.settings.questionCount, direction: props.settings.direction })
  index.value = 0
  score.value = 0
  done.value = false
  round.value = questions.value.length ? startRound(questions.value[0].prompt) : null
}
start()

function next() {
  if (index.value + 1 >= questions.value.length) {
    done.value = true
    return
  }
  index.value++
  round.value = startRound(questions.value[index.value].prompt)
}

async function guess(letter: string) {
  if (!round.value || round.value.status !== 'playing') return
  round.value = guessLetter(round.value, letter, props.settings.maxMistakes)
  if (round.value.status === 'playing') return
  if (round.value.status === 'won') score.value++
  await wait(1400)
  next()
}

const secretKeys = computed(() => (round.value ? [...new Set(round.value.cells.flatMap((c) => (c.key ? [c.key] : [])))] : []))
const word = computed(() => round.value?.cells.map((c) => c.char).join('') ?? '')

function onKeydown(e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey || e.altKey || !/^[a-z]$/i.test(e.key)) return
  guess(e.key.toLowerCase())
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <GameShell :title="gt('name')" @restart="start">
    <template #status>
      <span v-if="!done">{{ Math.min(index + 1, questions.length) }} / {{ questions.length }} · ⭐ {{ score }}</span>
    </template>

    <div v-if="!done && round" class="hangman">
      <PromptCard :prompt="round.prompt" compact />
      <HangmanGallows :wrong-guesses="round.wrongGuesses" :max-mistakes="props.settings.maxMistakes" />

      <div class="word" aria-live="polite">
        <span v-for="(cell, i) in round.cells" :key="i" class="cell" :class="{ blank: cell.key && !cell.revealed }">
          {{ cell.revealed ? cell.char : cell.key ? '_' : cell.char }}
        </span>
      </div>

      <p v-if="round.status === 'lost'" class="lost">{{ gt('lost', { word }) }}</p>

      <HangmanKeyboard :guessed="round.guessed" :secret-keys="secretKeys" :disabled="round.status !== 'playing'" @guess="guess" />
    </div>

    <ResultScreen
      v-else
      :title="t('game.done')"
      :subtitle="t('game.score', { score, total: questions.length })"
      :ratio="questions.length ? score / questions.length : 0"
      @again="start"
    />
  </GameShell>
</template>

<style scoped>
.hangman {
  max-width: 560px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-top: 8px;
}
.word {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  font: 800 clamp(1.4rem, 5vw, 2rem) var(--font-display);
}
.cell {
  min-width: 0.9em;
  text-align: center;
  border-bottom: 3px solid var(--line);
}
.cell.blank {
  color: transparent;
}
.lost {
  text-align: center;
  font-weight: 700;
  color: var(--bad-ink);
}
</style>
