<script setup lang="ts">
import { gameName } from '../i18n'
import type { GameProps } from '../types'
import type { MultipleChoiceSettings } from './types'
import QuizGame from '../shared/ui/QuizGame.vue'

defineProps<GameProps<MultipleChoiceSettings>>()
</script>

<template>
  <QuizGame
    :title="gameName({ id: 'multiple-choice' })"
    mode="choice"
    :vocabulary="vocabulary"
    :direction="settings.direction"
    :question-count="settings.questionCount"
    :answer-count="settings.answerCount"
  />
</template>
