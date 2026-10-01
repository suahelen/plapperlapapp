import { defineAsyncComponent } from 'vue'
import type { GameDefinition } from '../types'
import { directionField } from '../shared/fields'
import type { MultipleChoiceSettings } from './types'

export const multipleChoiceGame: GameDefinition<MultipleChoiceSettings> = {
  id: 'multiple-choice',
  icon: '✅',
  color: 'var(--game-choice)',
  minWords: 2,
  component: defineAsyncComponent(() => import('./MultipleChoiceGame.vue')),
  defaultSettings: { direction: 'source-to-target', answerCount: 4, questionCount: 10 },
  settingsFields: [
    directionField,
    { key: 'answerCount', label: 'games.multiple-choice.settings.answerCount', type: 'number', min: 2, max: 6 },
    { key: 'questionCount', label: 'games.multiple-choice.settings.questionCount', type: 'number', min: 3, max: 50 },
  ],
}
