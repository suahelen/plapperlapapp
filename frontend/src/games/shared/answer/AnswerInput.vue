<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed, ref } from 'vue'
import type { AnswerMode, AnswerResult, Prompt } from './prompt'
import { ANSWER_MODES } from './modes'
import { ensureSpeechStatus, speech } from './speech'

/**
 * Modality switch: games ask for an answer and receive an AnswerResult, without
 * knowing whether it was typed, tapped or spoken. `modes` are the ones the teacher
 * allowed; students switch between those available on their device. Render with a new
 * `:key` per prompt to reset it.
 *
 * With `deferred`, the answer is only submitted, not judged: the input locks and shows
 * no right/wrong feedback, because someone else (e.g. the multiplayer server) decides.
 */
const props = defineProps<{ prompt: Prompt; modes: AnswerMode[]; choices?: string[]; deferred?: boolean }>()
const emit = defineEmits<{ answer: [AnswerResult] }>()
const { t } = useI18n()

const PREF_KEY = 'answerMode'

if (props.modes.includes('spoken')) void ensureSpeechStatus()

const result = ref<AnswerResult | null>(null)
const locked = ref(false)
const done = computed(() => !!result.value || locked.value)

const available = computed(() => props.modes.filter((m) => ANSWER_MODES[m].isAvailable({ choices: props.choices })))
// Nothing allowed works here (e.g. speech only, but no microphone): typing always does.
const fallback = computed(() => available.value.length === 0)
const offered = computed<AnswerMode[]>(() => (fallback.value ? ['typed'] : available.value))

function readPref(): AnswerMode | null {
  try {
    return localStorage.getItem(PREF_KEY) as AnswerMode | null
  } catch {
    return null
  }
}
const chosen = ref<AnswerMode | null>(readPref())
const current = computed<AnswerMode>(() =>
  chosen.value && offered.value.includes(chosen.value) ? chosen.value : offered.value[0],
)

function choose(mode: AnswerMode) {
  if (done.value) return
  chosen.value = mode
  try {
    localStorage.setItem(PREF_KEY, mode)
  } catch {
    // private mode: the choice just isn't remembered
  }
}

function onAnswer(r: AnswerResult) {
  if (props.deferred) locked.value = true
  else result.value = r
  emit('answer', r)
}
</script>

<template>
  <div class="answer">
    <div v-if="offered.length > 1" class="modes" role="tablist" :aria-label="t('answer.modesLabel')">
      <button
        v-for="m in offered"
        :key="m"
        type="button"
        role="tab"
        class="mode"
        :class="{ active: m === current }"
        :aria-selected="m === current"
        :disabled="done && m !== current"
        @click="choose(m)"
      >
        <span aria-hidden="true">{{ ANSWER_MODES[m].icon }}</span> {{ t(ANSWER_MODES[m].label) }}
      </button>
    </div>
    <p v-else-if="fallback && modes.includes('spoken') && speech.loaded" class="hint muted">
      {{ t('answer.noSpeechHere') }}
    </p>

    <component
      :is="ANSWER_MODES[current].component"
      :key="current"
      :prompt="prompt"
      :choices="choices"
      :result="result"
      :locked="locked"
      @answer="onAnswer"
    />

    <Transition name="pop">
      <div v-if="result" class="feedback" :class="result.correct ? 'good' : 'bad'" role="status">
        <template v-if="result.correct">{{ t('answer.correct') }}</template>
        <i18n-t v-else keypath="answer.wrong" tag="span">
          <template #expected><strong>{{ result.expected }}</strong></template>
        </i18n-t>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.answer {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.modes {
  display: flex;
  align-self: center;
  gap: 4px;
  padding: 4px;
  border-radius: 999px;
  background: var(--bg);
  border: 1px solid var(--line);
}
.mode {
  border: 0;
  background: transparent;
  padding: 6px 14px;
  border-radius: 999px;
  font: inherit;
  font-weight: 600;
  font-size: 0.92rem;
  color: var(--muted);
  cursor: pointer;
  min-height: 36px;
}
.mode.active {
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--shadow-sm);
}
.mode:disabled {
  opacity: 0.4;
  cursor: default;
}
.hint {
  margin: 0;
  text-align: center;
  font-size: 0.9rem;
}
.feedback {
  text-align: center;
  font-weight: 700;
  font-size: 1.05rem;
  padding: 10px 14px;
  border-radius: var(--radius-sm);
}
.feedback.good {
  background: var(--good-soft);
  color: var(--good-ink);
}
.feedback.bad {
  background: var(--bad-soft);
  color: var(--bad-ink);
}
.pop-enter-active {
  transition:
    transform 0.25s var(--ease-bounce),
    opacity 0.2s ease;
}
.pop-enter-from {
  transform: scale(0.9);
  opacity: 0;
}
</style>
