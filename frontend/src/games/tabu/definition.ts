import { defineAsyncComponent } from 'vue'
import type { GameDefinition } from '../types'
import type { TabuSettings } from './types'

export const tabuGame: GameDefinition<TabuSettings> = {
  id: 'tabu',
  icon: '🤫',
  color: 'var(--game-tabu)',
  minWords: 6,
  component: defineAsyncComponent(() => import('./TabuGame.vue')),
  defaultSettings: { roundSeconds: 60 },
  settingsFields: [{ key: 'roundSeconds', label: 'games.tabu.settings.roundSeconds', type: 'number', min: 20, max: 120, step: 5 }],
}
