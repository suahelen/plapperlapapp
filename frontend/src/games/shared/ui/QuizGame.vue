<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed, ref, shallowRef } from 'vue'
import type { Direction, VocabularyItem } from '../../types'
import { buildQuiz, type QuizQuestion } from '../quiz'
import type { AnswerMode, AnswerResult } from '../answer/prompt'
import AnswerInput from '../answer/AnswerInput.vue'
import PromptCard from '../answer/PromptCard.vue'
import GameShell from './GameShell.vue'
import ResultScreen from './ResultScreen.vue'
import { useTimers } from '../timing'

/** A simple question-by-question quiz, used by the Multiple Choice and Typing games. */
const props = defineProps<{
  title: string
  vocabulary: VocabularyItem[]
  mode: AnswerMode
  direction: Direction
  questionCount: number
  answerCount?: number
}>()

const { wait, cancelAll } = useTimers()

const questions = shallowRef<QuizQuestion[]>([])
const index = ref(0)
const score = ref(0)
const result = ref<AnswerResult | null>(null)
const done = ref(false)
const mistakes = ref<{ question: string; expected: string; given: string }[]>([])

const current = computed(() => questions.value[index.value])

function start() {
  cancelAll()
  questions.value = buildQuiz(props.vocabulary, {
    count: props.questionCount,
    direction: props.direction,
    answerCount: props.mode === 'choice' ? props.answerCount : undefined,
  })
  index.value = 0
  score.value = 0
  result.value = null
  mistakes.value = []
  done.value = false
}
start()

async function onAnswer(r: AnswerResult) {
  result.value = r
  if (r.correct) {
    score.value++
    await wait(800)
    next()
  } else {
    mistakes.value.push({ question: current.value.prompt.question, expected: r.expected, given: r.given })
  }
}

function next() {
  result.value = null
  if (index.value + 1 >= questions.value.length) done.value = true
  else index.value++
}
const { t } = useI18n()
</script>

<template>
  <GameShell :title="title" @restart="start">
    <template #status>
      <span v-if="!done">{{ Math.min(index + 1, questions.length) }} / {{ questions.length }} · ⭐ {{ score }}</span>
    </template>

    <div v-if="!done && current" class="quiz">
      <div class="progress" aria-hidden="true">
        <i :style="{ width: `${(index / questions.length) * 100}%` }" />
      </div>
      <Transition name="swap" mode="out-in">
        <div :key="index" class="question">
          <PromptCard :prompt="current.prompt" />
          <AnswerInput :prompt="current.prompt" :modes="[mode]" :choices="current.choices" @answer="onAnswer" />
          <button v-if="result && !result.correct" class="btn btn-accent btn-lg" type="button" autofocus @click="next">
            {{ t('game.next') }}
          </button>
        </div>
      </Transition>
    </div>

    <ResultScreen
      v-else
      :title="t('game.done')"
      :subtitle="t('game.score', { score, total: questions.length })"
      :ratio="questions.length ? score / questions.length : 0"
      @again="start"
    >
      <div v-if="mistakes.length" class="mistakes">
        <h3>{{ t('game.practice') }}</h3>
        <ul>
          <li v-for="(m, i) in mistakes" :key="i">
            <span>{{ m.question }}</span>
            <strong>{{ m.expected }}</strong>
          </li>
        </ul>
      </div>
    </ResultScreen>
  </GameShell>
</template>

<style scoped>
.quiz {
  max-width: 560px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-top: 8px;
}
.question {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.progress {
  height: 8px;
  border-radius: 999px;
  background: var(--surface-2);
  overflow: hidden;
}
.progress i {
  display: block;
  height: 100%;
  background: var(--accent);
  border-radius: inherit;
  transition: width 0.4s ease;
}
.mistakes {
  text-align: left;
  margin-bottom: 20px;
}
.mistakes ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
.mistakes li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
}
.swap-enter-active,
.swap-leave-active {
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}
.swap-enter-from {
  transform: translateX(16px);
  opacity: 0;
}
.swap-leave-to {
  transform: translateX(-16px);
  opacity: 0;
}
</style>
