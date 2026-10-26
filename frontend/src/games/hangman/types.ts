import type { Direction, SettingValue } from '../types'

export interface HangmanSettings {
  [key: string]: SettingValue
  direction: Direction
  questionCount: number
  maxMistakes: number
}
