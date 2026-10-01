/** Player view sent by the server for multi-device Memory (backend/internal/rooms/memory). */
export interface MemoryRoomView {
  phase: 'lobby' | 'playing' | 'finished'
  you: number
  turn: number
  minPlayers: number
  players: { name: string; score: number }[]
  cards: { faceUp: boolean; matched: boolean; owner: number; text?: string; side?: string }[]
  winners: number[]
  lastEvent: { seq: number; seat: number; kind: 'flip' | 'match' | 'mismatch' | 'skip'; cards?: number[] } | null
}
