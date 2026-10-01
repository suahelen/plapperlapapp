import type { SettingValue } from '../types'
export interface MemorySettings {
  [key: string]: SettingValue
  pairs: number
}

export interface Card {
  id: number
  pairId: string
  text: string
  side: 'source' | 'target'
  matched: boolean
}

export interface MemoryState {
  cards: Card[]
  /** Indices of face-up, unmatched cards (at most two). */
  flipped: number[]
  attempts: number
  matchedPairs: number
  totalPairs: number
  finished: boolean
}
