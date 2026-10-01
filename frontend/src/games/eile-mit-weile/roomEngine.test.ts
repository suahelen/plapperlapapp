// Mirrors backend/internal/rooms/eilemitweile/engine_test.go.
import { describe, expect, it } from 'vitest'
import { eileRoomEngine as e, type EileRoomState } from './roomEngine'
import { RuleError } from '../shared/room/rules'
import { seededRng } from '../shared/random'
import { goalOf } from './logic'

const items = [
  { id: '1', source: 'house', target: 'Haus' },
  { id: '2', source: 'tree', target: 'Baum' },
  { id: '3', source: 'dog', target: 'Hund' },
]
const rng = seededRng(21)

function started(players: number, settings: Record<string, unknown> = {}): EileRoomState {
  const s = e.create({ items, settings })
  for (let i = 0; i < players; i++) e.join(s, i, `P${i}`)
  e.apply(s, 0, { type: 'start' }, rng)
  return s
}
/** Rolls, then forces the die value (the engine rolls randomly). */
function rollAs(s: EileRoomState, value: number) {
  e.apply(s, s.game!.current, { type: 'roll' }, rng)
  s.game = { ...s.game!, roll: value }
}
function answerAs(s: EileRoomState, correct: boolean) {
  e.apply(s, s.game!.current, { type: 'answer', answer: correct ? s.prompt!.expected : 'definitely wrong' }, rng)
}
function setPawns(s: EileRoomState, pawns: number[][]) {
  s.game = { ...s.game!, players: s.game!.players.map((p, i) => ({ ...p, pawns: pawns[i] ?? p.pawns })) }
}
const code = (fn: () => void) => {
  try {
    fn()
  } catch (err) {
    return err instanceof RuleError ? err.code : String(err)
  }
  return null
}

describe('multi-device Eile mit Weile (test mode)', () => {
  it('seats two players opposite and closes the lobby', () => {
    const s = started(2)
    expect(e.view(s, 0).players.map((p) => p.color)).toEqual(['red', 'green'])
    expect(code(() => e.join(s, 2, 'Late'))).toBe('GAME_STARTED')
  })

  it('moves on a correct answer, not on a wrong one', () => {
    const s = started(2)
    expect(code(() => e.apply(s, 1, { type: 'roll' }, rng))).toBe('NOT_YOUR_TURN')
    rollAs(s, 3)
    expect(e.view(s, 1).prompt).not.toBeNull()
    answerAs(s, true)
    expect([s.game!.players[0].pawns, s.last?.kind, s.game!.current]).toEqual([[2], 'move', 1])

    rollAs(s, 6)
    answerAs(s, false)
    expect(s.game!.players[1].pawns).toEqual([-1])
    expect(s.last).toMatchObject({ kind: 'wrong', expected: expect.any(String) })
    expect(s.game!.current).toBe(0)
  })

  it('captures off a Bänkli but not on one', () => {
    const s = started(2)
    setPawns(s, [[2], [29]])
    rollAs(s, 3)
    answerAs(s, true)
    expect(s.game!.players[1].pawns).toEqual([-1])
    expect(s.last?.captured).toHaveLength(1)

    const safe = started(2)
    setPawns(safe, [[3], [30]])
    rollAs(safe, 3)
    answerAs(safe, true)
    expect(safe.game!.players[1].pawns).toEqual([30])
  })

  it('lets the player choose a pawn, then wins and rematches', () => {
    const s = started(2, { pawnsPerPlayer: 2 })
    const goal = goalOf(s.config)
    setPawns(s, [[goal - 1, 10]])
    rollAs(s, 1)
    answerAs(s, true)
    expect(e.view(s, 0).movable).toEqual([0, 1])
    expect(code(() => e.apply(s, 0, { type: 'choose', pawn: 5 }, rng))).toBe('INVALID_PAWN')
    e.apply(s, 0, { type: 'choose', pawn: 0 }, rng)
    expect(s.game!.players[0].pawns).toEqual([goal, 10])

    s.game = { ...s.game!, current: 0, phase: 'roll' }
    setPawns(s, [[goal, goal - 2]])
    rollAs(s, 5)
    answerAs(s, true)
    expect([e.view(s, 0).phase, e.view(s, 0).winner]).toEqual(['finished', 0])
    e.apply(s, 1, { type: 'rematch' }, rng)
    expect([s.game!.phase, s.game!.current, s.game!.players[0].pawns[0]]).toEqual(['roll', 1, -1])
  })

  it('hides the answer and lets the host skip', () => {
    const s = started(3)
    rollAs(s, 2)
    answerAs(s, false) // → P1
    rollAs(s, 4)
    expect(JSON.stringify(e.view(s, 2))).not.toContain(`"${s.prompt!.expected}"`)
    expect(code(() => e.apply(s, 2, { type: 'skip' }, rng))).toBe('NOT_HOST')
    e.apply(s, 0, { type: 'skip' }, rng)
    expect([s.game!.current, s.game!.phase]).toEqual([2, 'roll'])
  })
})
