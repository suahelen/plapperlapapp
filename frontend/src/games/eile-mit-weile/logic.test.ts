import { describe, expect, it } from 'vitest'
import {
  answer,
  choosePawn,
  cpuPickPawn,
  createGame,
  goalOf,
  isSafeField,
  movablePawns,
  movePath,
  rollDie,
  startFieldOf,
  trackField,
} from './logic'
import type { BoardConfig, GameState } from './types'

const config: BoardConfig = { trackLength: 48, homeLength: 4, pawnsPerPlayer: 1, sixRollsAgain: true }
const two = () => createGame([{ isCpu: false }, { isCpu: false }], config)

function withPawns(state: GameState, pawns: number[][]): GameState {
  return { ...state, players: state.players.map((p, i) => ({ ...p, pawns: pawns[i] ?? p.pawns })) }
}

describe('board', () => {
  it('seats two players opposite each other', () => {
    const s = two()
    expect(s.players.map((p) => p.color)).toEqual(['red', 'green'])
    expect(startFieldOf('red', config)).toBe(0)
    expect(startFieldOf('green', config)).toBe(24)
  })

  it('maps progress to track fields, wrapping around', () => {
    expect(trackField('green', 0, config)).toBe(24)
    expect(trackField('green', 30, config)).toBe(6)
    expect(trackField('red', -1, config)).toBeNull()
    expect(trackField('red', 48, config)).toBeNull()
  })

  it('marks every eighth field as safe', () => {
    expect([0, 6, 12, 24, 42].every((f) => isSafeField(f, config))).toBe(true)
    expect(isSafeField(5, config)).toBe(false)
  })
})

describe('turn flow', () => {
  it('moves out of the stall on a correct answer', () => {
    let s = rollDie(two(), 3)
    expect(s.phase).toBe('answer')
    s = answer(s, true)
    expect(s.players[0].pawns).toEqual([2])
    expect(s.lastMove).toMatchObject({ player: 0, from: -1, to: 2 })
    expect(s.current).toBe(1)
    expect(s.players[0]).toMatchObject({ correct: 1, answered: 1 })
  })

  it('does not move on a wrong answer and passes the turn', () => {
    let s = rollDie(two(), 6)
    s = answer(s, false)
    expect(s.players[0].pawns).toEqual([-1])
    expect(s.current).toBe(1)
    expect(s.lastMove).toBeNull()
    expect(s.players[0]).toMatchObject({ correct: 0, answered: 1 })
  })

  it('gives another roll after a correct 6 when enabled', () => {
    const s = answer(rollDie(two(), 6), true)
    expect(s.current).toBe(0)
    expect(s.phase).toBe('roll')

    const off = createGame([{ isCpu: false }, { isCpu: false }], { ...config, sixRollsAgain: false })
    expect(answer(rollDie(off, 6), true).current).toBe(1)
  })

  it('ignores actions in the wrong phase', () => {
    const s = two()
    expect(answer(s, true)).toBe(s)
    const rolled = rollDie(s, 2)
    expect(rollDie(rolled, 5)).toBe(rolled)
  })

  it('counts rounds', () => {
    let s = two()
    s = answer(rollDie(s, 2), false)
    expect(s.turn).toBe(1)
    s = answer(rollDie(s, 2), false)
    expect(s.turn).toBe(2)
  })
})

describe('captures', () => {
  it('sends an opponent back to the stall', () => {
    // Green at progress 29 sits on field 5 (not a Bänkli); red moves from 2 to 5.
    let s = withPawns(two(), [[2], [29]])
    expect(trackField('green', 29, config)).toBe(5)
    s = answer(rollDie(s, 3), true)
    expect(s.players[0].pawns).toEqual([5])
    expect(s.players[1].pawns).toEqual([-1])
    expect(s.lastMove?.captured).toEqual([{ player: 1, pawn: 0, from: 29 }])
  })

  it('protects pawns on a Bänkli', () => {
    let s = withPawns(two(), [[3], [30]]) // green on field 6 (safe)
    s = answer(rollDie(s, 3), true)
    expect(s.players[0].pawns).toEqual([6])
    expect(s.players[1].pawns).toEqual([30])
    expect(s.lastMove?.captured).toEqual([])
  })
})

describe('home stretch and winning', () => {
  it('enters the home stretch after a full lap and stops on the goal', () => {
    const goal = goalOf(config)
    let s = withPawns(two(), [[46]])
    s = answer(rollDie(s, 3), true)
    expect(s.players[0].pawns).toEqual([49])
    expect(trackField('red', 49, config)).toBeNull()

    s = withPawns({ ...s, current: 0, phase: 'roll' }, [[goal - 2]])
    s = answer(rollDie(s, 5), true)
    expect(s.players[0].pawns).toEqual([goal])
    expect(s.phase).toBe('finished')
    expect(s.winner).toBe(0)
  })

  it('needs all pawns at the goal to win', () => {
    const c = { ...config, pawnsPerPlayer: 2 }
    const goal = goalOf(c)
    let s = createGame([{ isCpu: false }, { isCpu: false }], c)
    s = withPawns(s, [[goal - 1, 10]])
    s = rollDie(s, 1)
    s = answer(s, true)
    expect(s.phase).toBe('choose-pawn')
    s = choosePawn(s, 0)
    expect(s.players[0].pawns).toEqual([goal, 10])
    expect(s.phase).toBe('roll')
    expect(s.winner).toBeNull()
  })
})

describe('pawn choice', () => {
  const c = { ...config, pawnsPerPlayer: 3 }

  it('offers one pawn per distinct position, skipping finished pawns', () => {
    const s = withPawns(createGame([{ isCpu: false }], c), [[-1, -1, goalOf(c)]])
    expect(movablePawns(s)).toEqual([0])
    // With a single option the move happens without asking.
    const moved = answer(rollDie(s, 2), true)
    expect(moved.players[0].pawns).toEqual([1, -1, goalOf(c)])
  })

  it('rejects choosing a pawn that cannot move', () => {
    let s = withPawns(createGame([{ isCpu: false }], c), [[-1, 5, goalOf(c)]])
    s = answer(rollDie(s, 2), true)
    expect(s.phase).toBe('choose-pawn')
    expect(choosePawn(s, 2)).toBe(s)
  })

  it('computer prefers captures, then leaving the stall', () => {
    let s = createGame([{ isCpu: true }, { isCpu: false }], c)
    s = withPawns(s, [
      [-1, 10, 2],
      [29, -1, -1],
    ])
    s = rollDie(s, 3) // pawn 2 (progress 2) → 5 captures green on field 5
    expect(cpuPickPawn(s)).toBe(2)

    s = withPawns(rollDie(createGame([{ isCpu: true }, { isCpu: false }], c), 3), [[-1, 10, 2]])
    expect(cpuPickPawn(s)).toBe(0)
  })
})

describe('movePath', () => {
  it('lists each intermediate step', () => {
    expect(movePath(-1, 2)).toEqual([0, 1, 2])
    expect(movePath(4, 4)).toEqual([])
  })
})
