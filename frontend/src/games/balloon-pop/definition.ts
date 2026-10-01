import { defineAsyncComponent } from 'vue'
import type { GameDefinition } from '../types'
import { directionField } from '../shared/fields'
import type { BalloonPopSettings } from './types'

export const balloonPopGame: GameDefinition<BalloonPopSettings> = {
  id: 'balloon-pop',
  icon: '🎈',
  color: 'var(--game-balloon)',
  minWords: 3,
  component: defineAsyncComponent(() => import('./BalloonPopGame.vue')),
  defaultSettings: {
    direction: 'source-to-target',
    balloonCount: 4,
    lives: 3,
    speed: 'normal',
    rounds: 15,
  },
  settingsFields: [
    directionField,
    {
      key: 'balloonCount',
      label: 'games.balloon-pop.settings.balloons',
      type: 'select',
      options: [
        { value: 3, label: '3' },
        { value: 4, label: '4' },
        { value: 5, label: '5' },
      ],
    },
    {
      key: 'speed',
      label: 'games.balloon-pop.settings.speed',
      type: 'select',
      options: [
        { value: 'slow', label: 'games.balloon-pop.settings.slow' },
        { value: 'normal', label: 'games.balloon-pop.settings.normal' },
        { value: 'fast', label: 'games.balloon-pop.settings.fast' },
      ],
    },
    { key: 'lives', label: 'games.balloon-pop.settings.lives', type: 'number', min: 1, max: 5 },
    { key: 'rounds', label: 'games.balloon-pop.settings.rounds', type: 'number', min: 5, max: 50 },
  ],
}
