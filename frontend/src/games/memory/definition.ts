import { defineAsyncComponent } from 'vue'
import type { GameDefinition } from '../types'
import type { MemorySettings } from './types'

export const memoryGame: GameDefinition<MemorySettings> = {
  id: 'memory',
  icon: '🃏',
  color: 'var(--game-memory)',
  minWords: 2,
  component: defineAsyncComponent(() => import('./MemoryGame.vue')),
  multiplayer: { minPlayers: 2, maxPlayers: 4, component: defineAsyncComponent(() => import('./MemoryRoomGame.vue')) },
  defaultSettings: { pairs: 8 },
  settingsFields: [{ key: 'pairs', label: 'games.memory.settings.pairs', type: 'number', min: 2, max: 15 }],
}
