<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ref } from 'vue'
import type { AnswerResult, Prompt } from './prompt'

const props = defineProps<{ prompt: Prompt; choices: string[]; result: AnswerResult | null; locked?: boolean }>()
const emit = defineEmits<{ answer: [AnswerResult] }>()
const { t } = useI18n()

const picked = ref<string | null>(null)

function pick(choice: string) {
  if (props.result || props.locked) return
  picked.value = choice
  emit('answer', { correct: choice === props.prompt.expected, given: choice, expected: props.prompt.expected })
}

function stateOf(choice: string) {
  if (!props.result) return props.locked ? (choice === picked.value ? 'picked' : 'dim') : ''
  if (choice === props.prompt.expected) return 'good'
  if (choice === props.result.given) return 'bad'
  return 'dim'
}
</script>

<template>
  <div class="choices" role="group" :aria-label="t('answer.choicesLabel')">
    <button
      v-for="choice in choices"
      :key="choice"
      type="button"
      class="choice"
      :class="stateOf(choice)"
      :disabled="!!result || locked"
      @click="pick(choice)"
    >
      <span class="mark" aria-hidden="true">{{ stateOf(choice) === 'good' ? '✓' : stateOf(choice) === 'bad' ? '✗' : '' }}</span>
      {{ choice }}
    </button>
  </div>
</template>

<style scoped>
.choices {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
}
.choice {
  position: relative;
  min-height: 56px;
  padding: 12px 16px;
  border: 2px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-bright);
  color: var(--ink);
  font: 700 1.05rem var(--font-display);
  cursor: pointer;
  overflow-wrap: anywhere;
  box-shadow: 0 3px 0 var(--line);
  transition:
    transform 0.1s ease,
    background 0.15s ease,
    border-color 0.15s ease;
}
.choice:hover:not(:disabled) {
  border-color: var(--accent);
  transform: translateY(-1px);
}
.choice:active:not(:disabled) {
  transform: translateY(2px);
  box-shadow: 0 1px 0 var(--line);
}
.choice:disabled {
  cursor: default;
}
.choice.good {
  background: var(--good-soft);
  border-color: var(--good);
  box-shadow: 0 3px 0 var(--good);
  color: var(--good-ink);
}
.choice.bad {
  background: var(--bad-soft);
  border-color: var(--bad);
  box-shadow: 0 3px 0 var(--bad);
  color: var(--bad-ink);
  animation: shake 0.35s ease;
}
.choice.picked {
  border-color: var(--accent);
  background: var(--accent-soft);
  box-shadow: 0 3px 0 var(--accent);
}
.choice.dim {
  opacity: 0.5;
}
.mark {
  position: absolute;
  top: 6px;
  right: 10px;
  font-size: 0.9rem;
}
@keyframes shake {
  25% {
    transform: translateX(-4px);
  }
  75% {
    transform: translateX(4px);
  }
}
</style>
