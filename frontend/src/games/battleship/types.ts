import type { AnswerMode } from '../shared/answer/prompt'
import type { Direction, SettingValue } from '../types'

export interface BattleshipSettings {
  [key: string]: SettingValue
  direction: Direction
  answerModes: AnswerMode[]
}

export type Phase = 'waiting' | 'placing' | 'playing' | 'finished'

/** Shot states as seen by the shooter. */
export const SHOT = { none: 0, miss: 1, hit: 2, sunk: 3 } as const

export interface CellView {
  usable: boolean
  itemId?: string
  question?: string
  expectedSide?: 'source' | 'target'
  questionLang?: string
  expectedLang?: string
}

export interface ShotEvent {
  seq: number
  seat: number
  row: number
  col: number
  kind: 'miss' | 'hit' | 'sunk' | 'wrong'
  given?: string
  expected?: string
}

export interface SideView {
  joined: boolean
  ready: boolean
  /** Own ships always; opponent's only when sunk or after the game. [row, col] pairs. */
  ships: [number, number][][] | null
  /** Shots fired by this side (see SHOT). */
  shots: number[][]
}

/** One player's view, sent by the server (backend/internal/rooms/battleship). */
export interface BattleshipView {
  phase: Phase
  you: number
  turn: number
  winner: number
  rows: string[]
  cols: string[]
  grid: boolean
  cells: CellView[][]
  fleet: number[]
  me: SideView
  opponent: SideView
  lastEvent: ShotEvent | null
}
