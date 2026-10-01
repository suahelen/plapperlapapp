<script setup lang="ts">
import { gameName } from '../i18n'
import type { GameProps } from '../types'
import type { TypingSettings } from './types'
import QuizGame from '../shared/ui/QuizGame.vue'

defineProps<GameProps<TypingSettings>>()
</script>

<template>
  <QuizGame
    :title="gameName({ id: 'typing' })"
    mode="typed"
    :vocabulary="vocabulary"
    :direction="settings.direction"
    :question-count="settings.questionCount"
  />
</template>
