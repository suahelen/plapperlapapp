import { request } from './client'

export interface Totals {
  users: number
  words: number
  totalPlays: number
  byGame: Record<string, number>
}

export const getStats = () => request<Totals>('GET', '/stats')

/** Fire-and-forget: a game was actually started. Never blocks or breaks play on failure. */
export function recordPlay(gameType: string) {
  request<void>('POST', '/stats/play', { gameType }).catch(() => {})
}
