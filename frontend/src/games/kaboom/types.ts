import type { AnswerMode } from '../shared/answer/prompt'
import type { Direction, SettingValue } from '../types'

export interface KaboomSettings {
  [key: string]: SettingValue
  direction: Direction
  answerModes: AnswerMode[]
  sticks: number
  kaboomShare: 'low' | 'medium' | 'high'
  /** Minutes; 0 = play until the cup has no word sticks left. */
  timeLimit: number
}

export type Stick = { id: number; kind: 'word'; itemId: string } | { id: number; kind: 'kaboom' }

export interface Team {
  name: string
  color: string
  /** Word sticks the team has collected. */
  sticks: Stick[]
  correct: number
  answered: number
  kabooms: number
}

export type Phase = 'draw' | 'answer' | 'kaboom' | 'finished'

export interface KaboomState {
  cup: Stick[]
  teams: Team[]
  current: number
  phase: Phase
  drawn: Stick | null
  /** Sticks the current team lost in the last KABOOM (for the animation). */
  lost: number
}
