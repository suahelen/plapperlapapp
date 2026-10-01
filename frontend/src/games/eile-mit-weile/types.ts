import type { AnswerMode } from '../shared/answer/prompt'
import type { Direction, SettingValue } from '../types'

export interface EileMitWeileSettings {
  [key: string]: SettingValue
  direction: Direction
  answerModes: AnswerMode[]
  boardSize: number
  pawnsPerPlayer: number
  sixRollsAgain: boolean
}

export type PlayerColor = 'red' | 'blue' | 'green' | 'yellow'

export interface Player {
  color: PlayerColor
  name: string
  isCpu: boolean
  /**
   * Progress of each pawn relative to the player's own start:
   *  -1            waiting in the stall
   *  0..track-1    on the shared track (0 = own start field)
   *  track..       on the player's home stretch; track+home-1 is the goal
   */
  pawns: number[]
  correct: number
  answered: number
}

export interface BoardConfig {
  trackLength: number
  homeLength: number
  pawnsPerPlayer: number
  sixRollsAgain: boolean
}

export type Phase = 'roll' | 'answer' | 'choose-pawn' | 'finished'

export interface MoveEvent {
  player: number
  pawn: number
  from: number
  to: number
  /** Opponent pawns sent back to their stall. */
  captured: { player: number; pawn: number; from: number }[]
}

export interface GameState {
  config: BoardConfig
  players: Player[]
  current: number
  phase: Phase
  roll: number | null
  winner: number | null
  lastMove: MoveEvent | null
  turn: number
}
