<script setup lang="ts">
import { languageName } from '@/i18n'
import { useI18n } from 'vue-i18n'
import { onMounted, ref } from 'vue'
import { isCorrect } from './check'
import type { AnswerResult, Prompt } from './prompt'

const props = defineProps<{ prompt: Prompt; result: AnswerResult | null; locked?: boolean; choices?: string[] }>()
const emit = defineEmits<{ answer: [AnswerResult] }>()
const { t } = useI18n()

const value = ref('')
const input = ref<HTMLInputElement>()

onMounted(() => input.value?.focus())

function submit() {
  if (props.result || props.locked || value.value.trim() === '') return
  emit('answer', {
    correct: isCorrect(value.value, props.prompt.expected),
    given: value.value,
    expected: props.prompt.expected,
  })
}
</script>

<template>
  <form class="typed" @submit.prevent="submit">
    <input
      ref="input"
      v-model="value"
      class="input answer-input"
      :class="{ good: result?.correct, bad: result && !result.correct }"
      :disabled="!!result || locked"
      :placeholder="prompt.expectedLanguage ? t('answer.placeholderIn', { language: languageName(prompt.expectedLanguage) }) : t('answer.placeholder')"
      autocomplete="off"
      autocapitalize="off"
      autocorrect="off"
      spellcheck="false"
      enterkeyhint="done"
      :aria-label="t('answer.yourAnswer')"
    />
    <button v-if="!result && !locked" class="btn btn-primary" type="submit" :disabled="value.trim() === ''">{{ t('answer.check') }}</button>
  </form>
</template>

<style scoped>
.typed {
  display: flex;
  gap: 10px;
}
.answer-input {
  font-size: 1.2rem;
  min-height: 52px;
  text-align: center;
}
.answer-input.good {
  border-color: var(--good);
  background: var(--good-soft);
  color: var(--good-ink);
}
.answer-input.bad {
  border-color: var(--bad);
  background: var(--bad-soft);
  color: var(--bad-ink);
  text-decoration: line-through;
}
</style>
