import type { Direction, SettingValue } from '../types'

export interface MultipleChoiceSettings {
  [key: string]: SettingValue
  direction: Direction
  answerCount: number
  questionCount: number
}
