// Mirrors backend/internal/rooms/memory/engine_test.go.
import { describe, expect, it } from 'vitest'
import { memoryRoomEngine as e, type MemoryRoomState } from './roomEngine'
import { RuleError } from '../shared/room/rules'
import { seededRng } from '../shared/random'

const items = [
  { id: '1', source: 'house', target: 'Haus' },
  { id: '2', source: 'tree', target: 'Baum' },
  { id: '3', source: 'dog', target: 'Hund' },
]
const rng = seededRng(5)

function started(players: number): MemoryRoomState {
  const s = e.create({ items, settings: { pairs: 3 } })
  for (let i = 0; i < players; i++) e.join(s, i, `P${i}`)
  e.apply(s, 0, { type: 'start' }, rng)
  return s
}
const pairOf = (s: MemoryRoomState, id: string) => s.deck!.cards.flatMap((c, i) => (c.pairId === id ? [i] : []))
const flip = (s: MemoryRoomState, seat: number, index: number) => e.apply(s, seat, { type: 'flip', index }, rng)
const code = (fn: () => void) => {
  try {
    fn()
  } catch (err) {
    return err instanceof RuleError ? err.code : String(err)
  }
  return null
}

describe('multi-device memory (test mode)', () => {
  it('has a lobby that only the host can start with enough players', () => {
    const s = e.create({ items, settings: {} })
    e.join(s, 0, 'Host')
    expect(code(() => e.apply(s, 0, { type: 'start' }, rng))).toBe('NOT_ENOUGH_PLAYERS')
    e.join(s, 1, '')
    expect(s.roster.names[1]).toBe('')
    expect(code(() => e.apply(s, 1, { type: 'start' }, rng))).toBe('NOT_HOST')
    e.apply(s, 0, { type: 'start' }, rng)
    expect(e.view(s, 0).cards).toHaveLength(6)
    expect(code(() => e.join(s, 2, 'Late'))).toBe('GAME_STARTED')
  })

  it('keeps the turn on a match and scores it', () => {
    const s = started(2)
    const [a, b] = pairOf(s, '1')
    flip(s, 0, a)
    expect(code(() => flip(s, 1, b))).toBe('NOT_YOUR_TURN')
    flip(s, 0, b)
    expect([s.last?.kind, s.scores[0], s.turn]).toEqual(['match', 1, 0])
    expect(code(() => flip(s, 0, a))).toBe('INVALID_CARD')
  })

  it('passes the turn on a mismatch; cards stay visible until the next flip', () => {
    const s = started(2)
    const a = pairOf(s, '1')
    const b = pairOf(s, '2')
    flip(s, 0, a[0])
    flip(s, 0, b[0])
    expect([s.last?.kind, s.turn]).toEqual(['mismatch', 1])
    expect(e.view(s, 1).cards[a[0]].faceUp && e.view(s, 1).cards[b[0]].faceUp).toBe(true)
    flip(s, 1, a[1])
    const v = e.view(s, 1)
    expect([v.cards[a[0]].faceUp, v.cards[b[0]].faceUp, v.cards[a[1]].faceUp]).toEqual([false, false, true])
  })

  it('never reveals face-down cards', () => {
    const json = JSON.stringify(e.view(started(2), 0))
    for (const w of ['house', 'Haus', 'Baum', 'Hund']) expect(json).not.toContain(w)
  })

  it('finishes with winners and rotates the starter on rematch', () => {
    const s = started(3)
    for (const id of ['1', '2', '3']) {
      const [a, b] = pairOf(s, id)
      flip(s, 0, a)
      flip(s, 0, b)
    }
    expect(s.phase).toBe('finished')
    expect(e.view(s, 1).winners).toEqual([0])
    e.apply(s, 2, { type: 'rematch' }, rng)
    expect([s.phase, s.turn, s.scores[0]]).toEqual(['playing', 1, 0])
  })

  it('lets the host skip another player', () => {
    const s = started(3)
    const a = pairOf(s, '1')
    const b = pairOf(s, '2')
    flip(s, 0, a[0])
    flip(s, 0, b[0])
    expect(code(() => e.apply(s, 2, { type: 'skip' }, rng))).toBe('NOT_HOST')
    e.apply(s, 0, { type: 'skip' }, rng)
    expect([s.turn, s.deck!.flipped]).toEqual([2, []])
  })
})
