<script setup lang="ts">
import { languageName } from '@/i18n'
import type { Prompt } from './prompt'

// Shows the word a student has to translate. Future modalities (e.g. a text-to-speech
// button using speechSynthesis or metadata.sourceAudio) belong here.
defineProps<{ prompt: Prompt; compact?: boolean }>()
</script>

<template>
  <div class="prompt" :class="{ compact }">
    <div v-if="prompt.questionLanguage || prompt.expectedLanguage" class="langs">
      {{ languageName(prompt.questionLanguage) || '…' }} → {{ languageName(prompt.expectedLanguage) || '…' }}
    </div>
    <div class="word" lang="">{{ prompt.question }}</div>
    <slot />
  </div>
</template>

<style scoped>
.prompt {
  text-align: center;
  padding: 18px 20px;
  background: var(--surface);
  border-radius: var(--radius);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-sm);
}
.langs {
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  margin-bottom: 4px;
}
.word {
  font-family: var(--font-display);
  font-weight: 800;
  font-size: clamp(1.6rem, 6vw, 2.4rem);
  line-height: 1.15;
  overflow-wrap: anywhere;
}
.compact {
  padding: 10px 16px;
}
.compact .word {
  font-size: clamp(1.3rem, 5vw, 1.8rem);
}
</style>
