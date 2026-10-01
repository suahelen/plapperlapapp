import type { RoomPrompt } from '../shared/room/roomPrompt'
import type { PlayerColor } from './types'

/** Player view sent by the server for multi-device Eile mit Weile (backend/internal/rooms/eilemitweile). */
export interface EileRoomView {
  phase: 'lobby' | 'roll' | 'answer' | 'choose-pawn' | 'finished'
  you: number
  turn: number
  round: number
  minPlayers: number
  trackLength: number
  homeLength: number
  pawnsPerPlayer: number
  sixRollsAgain: boolean
  players: { name: string; color: PlayerColor; pawns: number[]; correct: number; answered: number }[]
  roll: number
  prompt: RoomPrompt | null
  movable: number[]
  winner: number
  lastEvent: {
    seq: number
    seat: number
    kind: 'roll' | 'correct' | 'wrong' | 'move' | 'skip'
    roll?: number
    pawn: number
    from: number
    to: number
    captured?: { player: number; pawn: number; from: number }[]
    given?: string
    expected?: string
  } | null
}
