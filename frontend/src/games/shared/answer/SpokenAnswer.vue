<script setup lang="ts">
import { errorMessage } from '@/api/client'
import { languageName } from '@/i18n'
import { useI18n } from 'vue-i18n'
import { computed, onBeforeUnmount, ref } from 'vue'
import { isCorrect } from './check'
import type { AnswerResult, Prompt } from './prompt'
import { speech } from './speech'
import { transcribe } from '@/api/speech'
import { startRecording, type Recorder } from '@/lib/recorder'
import { languageCode } from '@/lib/languages'
import { saidQuestionInstead } from './spoken'

/**
 * Spoken answer: record → local speech recognition → "Verstanden: …" → submit or retry.
 * Tap to start and tap to stop, or hold the button while speaking (push-to-talk).
 * The student confirms the transcript, so a misrecognition never counts as a wrong answer.
 */
const props = defineProps<{ prompt: Prompt; result: AnswerResult | null; locked?: boolean; choices?: string[] }>()
const emit = defineEmits<{ answer: [AnswerResult] }>()
const { t } = useI18n()

const MAX_SECONDS = 8
const HOLD_MS = 350

type Phase = 'idle' | 'starting' | 'recording' | 'transcribing' | 'heard'
const phase = ref<Phase>('idle')
const level = ref(0)
const heard = ref('')
const error = ref('')
const simulatedText = ref('')

let recorder: Recorder | null = null
let pressedAt = 0
let limitTimer: ReturnType<typeof setTimeout> | undefined

const done = computed(() => !!props.result || !!props.locked)
const language = computed(() => languageName(props.prompt.expectedLanguage))

async function start() {
  error.value = ''
  heard.value = ''
  phase.value = 'starting'
  try {
    recorder = await startRecording((l) => (level.value = l))
  } catch (e) {
    phase.value = 'idle'
    const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
    error.value = denied
      ? t('speech.micDenied')
      : t('speech.noMic')
    return
  }
  phase.value = 'recording'
  limitTimer = setTimeout(stop, MAX_SECONDS * 1000)
}

async function stop() {
  clearTimeout(limitTimer)
  if (phase.value !== 'recording' || !recorder) return
  const r = recorder
  recorder = null
  level.value = 0
  phase.value = 'transcribing'
  try {
    const result = await transcribe(await r.stop(), languageCode(props.prompt.expectedLanguage))
    const text = result.text.trim()
    if (!text) {
      phase.value = 'idle'
      error.value = t('speech.nothingHeard')
      return
    }
    if (saidQuestionInstead(result.heard, props.prompt)) {
      phase.value = 'idle'
      error.value = language.value
        ? t('speech.saidQuestionIn', { question: props.prompt.question, language: language.value })
        : t('speech.saidQuestion', { question: props.prompt.question })
      return
    }
    heard.value = text
    phase.value = 'heard'
  } catch (e) {
    phase.value = 'idle'
    error.value = errorMessage(e)
  }
}

function onPointerDown(e: PointerEvent) {
  if (done.value) return
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  pressedAt = performance.now()
  if (phase.value === 'idle' || phase.value === 'heard') void start()
  else if (phase.value === 'recording') void stop()
}
function onPointerUp() {
  // Held down while speaking → release ends the recording (push-to-talk).
  if (phase.value === 'recording' && performance.now() - pressedAt > HOLD_MS) void stop()
}
function onKeyboardClick(e: MouseEvent) {
  if (e.detail !== 0 || done.value) return // pointer clicks are handled above
  if (phase.value === 'recording') void stop()
  else if (phase.value === 'idle' || phase.value === 'heard') void start()
}

function submit(text: string) {
  if (done.value || !text.trim()) return
  emit('answer', { correct: isCorrect(text, props.prompt.expected), given: text, expected: props.prompt.expected })
}

onBeforeUnmount(() => {
  clearTimeout(limitTimer)
  recorder?.cancel()
})
</script>

<template>
  <!-- Test mode without the speech service: type what you would have said. -->
  <form v-if="speech.simulated" class="simulated" @submit.prevent="submit(simulatedText)">
    <span class="sim-label">{{ t('speech.simulated') }}</span>
    <div class="row">
      <input
        v-model="simulatedText"
        class="input"
        :disabled="done"
        autocomplete="off"
        :aria-label="t('speech.simulatedLabel')"
      />
      <button v-if="!done" class="btn btn-primary" type="submit" :disabled="!simulatedText.trim()">{{ t('speech.submit') }}</button>
    </div>
  </form>

  <div v-else class="spoken">
    <template v-if="!done && phase !== 'heard'">
      <button
        type="button"
        class="mic"
        :class="phase"
        :style="{ '--level': level }"
        :disabled="phase === 'starting' || phase === 'transcribing'"
        :aria-label="phase === 'recording' ? t('speech.stop') : t('speech.start')"
        @pointerdown.prevent="onPointerDown"
        @pointerup="onPointerUp"
        @click="onKeyboardClick"
      >
        <span class="ring" aria-hidden="true" />
        <span class="icon" aria-hidden="true">{{ phase === 'recording' ? '■' : '🎤' }}</span>
      </button>
      <p class="status" role="status">
        <template v-if="phase === 'recording'">{{ t('speech.listening') }}</template>
        <template v-else-if="phase === 'transcribing'">{{ t('speech.transcribing') }}</template>
        <template v-else-if="phase === 'starting'">{{ t('speech.starting') }}</template>
        <template v-else>
          {{ language ? t('speech.promptIn', { language }) : t('speech.prompt') }}
          <small class="tip">{{ t('speech.tip') }}</small>
        </template>
      </p>
    </template>

    <div v-else class="heard">
      <p class="transcript">
        <span class="muted">{{ t('speech.heard') }}</span> <strong>«{{ result?.given ?? heard }}»</strong>
      </p>
      <div v-if="!done" class="row">
        <button class="btn" type="button" @pointerdown.prevent="onPointerDown" @click="onKeyboardClick">🎤 {{ t('speech.again') }}</button>
        <button class="btn btn-primary" type="button" @click="submit(heard)">{{ t('speech.submit') }}</button>
      </div>
    </div>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.spoken {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.mic {
  position: relative;
  width: 76px;
  height: 76px;
  border-radius: 50%;
  border: 0;
  background: var(--primary);
  color: var(--on-color);
  font-size: 1.9rem;
  cursor: pointer;
  box-shadow: var(--shadow);
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  transition:
    transform 0.15s var(--ease-bounce),
    background 0.2s;
}
.mic:active {
  transform: scale(0.94);
}
.mic.recording {
  background: var(--bad);
}
.mic:disabled {
  opacity: 0.6;
  cursor: progress;
}
.ring {
  position: absolute;
  inset: -6px;
  border-radius: 50%;
  border: 4px solid color-mix(in srgb, var(--bad) 45%, transparent);
  transform: scale(calc(1 + var(--level, 0) * 0.35));
  opacity: 0;
  transition: transform 0.08s linear;
}
.mic.recording .ring {
  opacity: 1;
}
.icon {
  position: relative;
}
.status {
  margin: 0;
  color: var(--muted);
  font-weight: 600;
  text-align: center;
}
.tip {
  display: block;
  margin-top: 2px;
  font-weight: 500;
  font-size: 0.82rem;
}
.heard {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: 100%;
}
.transcript {
  margin: 0;
  font-size: 1.25rem;
  text-align: center;
}
.row {
  display: flex;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
}
.error {
  margin: 0;
  color: var(--bad-ink);
  font-weight: 600;
  text-align: center;
}
.simulated {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sim-label {
  font-size: 0.9rem;
  color: var(--muted);
  font-weight: 600;
}
.simulated .row {
  flex-wrap: nowrap;
}
.simulated .input {
  flex: 1;
  font-size: 1.2rem;
  min-height: 52px;
  text-align: center;
}
</style>
