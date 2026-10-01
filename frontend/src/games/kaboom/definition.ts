import { defineAsyncComponent } from 'vue'
import type { GameDefinition } from '../types'
import { answerModesField, directionField } from '../shared/fields'
import type { KaboomSettings } from './types'

export const kaboomGame: GameDefinition<KaboomSettings> = {
  id: 'kaboom',
  icon: '💥',
  color: 'var(--game-kaboom)',
  minWords: 2,
  component: defineAsyncComponent(() => import('./KaboomGame.vue')),
  multiplayer: { minPlayers: 2, maxPlayers: 6, component: defineAsyncComponent(() => import('./KaboomRoomGame.vue')) },
  defaultSettings: {
    direction: 'source-to-target',
    answerModes: ['typed'],
    sticks: 30,
    kaboomShare: 'medium',
    timeLimit: 0,
  },
  settingsFields: [
    directionField,
    answerModesField,
    { key: 'sticks', label: 'games.kaboom.settings.sticks', type: 'number', min: 5, max: 80 },
    {
      key: 'kaboomShare',
      label: 'games.kaboom.settings.share',
      type: 'select',
      options: [
        { value: 'low', label: 'games.kaboom.settings.shareLow' },
        { value: 'medium', label: 'games.kaboom.settings.shareMedium' },
        { value: 'high', label: 'games.kaboom.settings.shareHigh' },
      ],
    },
    {
      key: 'timeLimit',
      label: 'games.kaboom.settings.end',
      type: 'select',
      options: [
        { value: 0, label: 'games.kaboom.settings.endEmpty' },
        { value: 5, label: 'games.kaboom.settings.end5' },
        { value: 10, label: 'games.kaboom.settings.end10' },
        { value: 15, label: 'games.kaboom.settings.end15' },
        { value: 20, label: 'games.kaboom.settings.end20' },
      ],
    },
  ],
}
