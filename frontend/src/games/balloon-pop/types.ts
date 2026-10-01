import type { Direction, SettingValue } from '../types'
import type { Prompt } from '../shared/answer/prompt'

export interface BalloonPopSettings {
  [key: string]: SettingValue
  direction: Direction
  balloonCount: number
  lives: number
  speed: 'slow' | 'normal' | 'fast'
  rounds: number
}

export interface Balloon {
  id: number
  text: string
  correct: boolean
  /** Horizontal position in percent of the sky width. */
  x: number
  /** Start delay in seconds. */
  delay: number
  color: string
  popped: 'hit' | 'miss' | null
}

export interface Round {
  prompt: Prompt
  balloons: Balloon[]
  /** Seconds a balloon takes to float through the sky. */
  duration: number
}

export type Outcome = 'hit' | 'escaped' | null

export interface BalloonState {
  lives: number
  score: number
  streak: number
  bestStreak: number
  roundIndex: number
  totalRounds: number
  speedFactor: number
  round: Round | null
  phase: 'playing' | 'round-over' | 'finished'
  outcome: Outcome
  mistakes: number
}
