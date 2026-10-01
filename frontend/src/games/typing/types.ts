import type { Direction, SettingValue } from '../types'

export interface TypingSettings {
  [key: string]: SettingValue
  direction: Direction
  questionCount: number
}
