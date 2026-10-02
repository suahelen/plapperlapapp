import type { SettingValue, VocabularyItem } from '../types'

export interface TabuSettings {
  [key: string]: SettingValue
  roundSeconds: number
}

/** The secret word a describer sees, plus the words they may not say. */
export interface TabuWord {
  item: VocabularyItem
  taboo: string[]
}

/** The round in progress. Setup/ready/finished screens live in the component as UI-only stage. */
export interface TabuState {
  players: string[]
  scores: number[]
  describerIndex: number
  word: TabuWord | null
  secondsLeft: number
  correctThisTurn: number
  skippedThisTurn: number
}
