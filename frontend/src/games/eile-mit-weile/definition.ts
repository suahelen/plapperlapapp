import { defineAsyncComponent } from 'vue'
import type { GameDefinition } from '../types'
import { answerModesField, directionField } from '../shared/fields'
import type { EileMitWeileSettings } from './types'

export const eileMitWeileGame: GameDefinition<EileMitWeileSettings> = {
  id: 'eile-mit-weile',
  icon: '🎲',
  color: 'var(--game-eile)',
  minWords: 2,
  component: defineAsyncComponent(() => import('./EileMitWeileGame.vue')),
  multiplayer: {
    minPlayers: 2,
    maxPlayers: 4,
    component: defineAsyncComponent(() => import('./EileMitWeileRoomGame.vue')),
  },
  defaultSettings: {
    direction: 'source-to-target',
    answerModes: ['typed'],
    boardSize: 48,
    pawnsPerPlayer: 1,
    sixRollsAgain: true,
  },
  settingsFields: [
    directionField,
    answerModesField,
    {
      key: 'boardSize',
      label: 'games.eile-mit-weile.settings.boardSize',
      type: 'select',
      options: [
        { value: 32, label: 'games.eile-mit-weile.settings.boardShort' },
        { value: 48, label: 'games.eile-mit-weile.settings.boardNormal' },
        { value: 64, label: 'games.eile-mit-weile.settings.boardLong' },
      ],
    },
    { key: 'pawnsPerPlayer', label: 'games.eile-mit-weile.settings.pawns', type: 'number', min: 1, max: 4 },
    { key: 'sixRollsAgain', label: 'games.eile-mit-weile.settings.sixRollsAgain', type: 'boolean' },
  ],
}
