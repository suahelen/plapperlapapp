import { defineAsyncComponent } from 'vue'
import type { GameDefinition } from '../types'
import { directionField } from '../shared/fields'
import type { HangmanSettings } from './types'

export const hangmanGame: GameDefinition<HangmanSettings> = {
  id: 'hangman',
  icon: '🪢',
  color: 'var(--game-hangman)',
  minWords: 1,
  component: defineAsyncComponent(() => import('./HangmanGame.vue')),
  defaultSettings: { direction: 'source-to-target', questionCount: 10, maxMistakes: 6 },
  settingsFields: [
    directionField,
    { key: 'questionCount', label: 'games.hangman.settings.questionCount', type: 'number', min: 3, max: 50 },
    { key: 'maxMistakes', label: 'games.hangman.settings.maxMistakes', type: 'number', min: 3, max: 10 },
  ],
}
