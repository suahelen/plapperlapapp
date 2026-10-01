import { defineAsyncComponent } from 'vue'
import type { GameDefinition } from '../types'
import { directionField } from '../shared/fields'
import type { TypingSettings } from './types'

export const typingGame: GameDefinition<TypingSettings> = {
  id: 'typing',
  icon: '⌨️',
  color: 'var(--game-typing)',
  minWords: 1,
  component: defineAsyncComponent(() => import('./TypingGame.vue')),
  defaultSettings: { direction: 'source-to-target', questionCount: 10 },
  settingsFields: [directionField, { key: 'questionCount', label: 'games.typing.settings.questionCount', type: 'number', min: 3, max: 50 }],
}
