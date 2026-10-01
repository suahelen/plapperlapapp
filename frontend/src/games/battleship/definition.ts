import { defineAsyncComponent } from 'vue'
import type { GameDefinition } from '../types'
import { answerModesField, directionField } from '../shared/fields'
import type { BattleshipSettings } from './types'

export const battleshipGame: GameDefinition<BattleshipSettings> = {
  id: 'battleship',
  icon: '🚢',
  color: 'var(--game-battleship)',
  minWords: 4,
  // Multi-device only: hiding the fleets from each other is the point of the game.
  multiplayer: { minPlayers: 2, maxPlayers: 2, component: defineAsyncComponent(() => import('./BattleshipGame.vue')) },
  defaultSettings: { direction: 'source-to-target', answerModes: ['typed'] },
  settingsFields: [directionField, answerModesField],
}
