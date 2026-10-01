import type { RoomPrompt } from '../shared/room/roomPrompt'

/** Player view sent by the server for multi-device Kaboom (backend/internal/rooms/kaboom). */
export interface KaboomRoomView {
  phase: 'lobby' | 'draw' | 'answer' | 'kaboom' | 'finished'
  you: number
  turn: number
  minPlayers: number
  players: { name: string; sticks: number; correct: number; answered: number; kabooms: number }[]
  cupCount: number
  wordsLeft: number
  capacity: number
  prompt: RoomPrompt | null
  /** Epoch ms; 0 = no time limit. */
  endsAt: number
  winners: number[]
  lastEvent: {
    seq: number
    seat: number
    kind: 'word' | 'kaboom' | 'correct' | 'wrong' | 'skip' | 'timeup'
    lost?: number
    given?: string
    expected?: string
  } | null
}
