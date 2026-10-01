// Mirrors backend/internal/rooms/battleship/engine_test.go: the TypeScript engine only
// simulates the server in test mode, but must follow the same rules.
import { describe, expect, it } from 'vitest'
import { RuleError, battleshipEngine as e, fleetFor, placeFleet, type BattleshipState, type EngineItem } from './engine'
import { seededRng } from '../shared/random'
import { SHOT } from './types'

const plain = (n: number): EngineItem[] =>
  Array.from({ length: n }, (_, i) => ({ id: String(i), source: `word${i}`, target: `Wort${i}` }))

const pronouns = ['je', 'tu', 'il/elle', 'nous', 'vous', 'ils/elles']
const forms: Record<string, string[]> = {
  être: ['suis', 'es', 'est', 'sommes', 'êtes', 'sont'],
  avoir: ['ai', 'as', 'a', 'avons', 'avez', 'ont'],
  aller: ['vais', 'vas', 'va', 'allons', 'allez', 'vont'],
}
const conjugation = (): EngineItem[] =>
  Object.entries(forms).flatMap(([verb, fs]) =>
    pronouns.map((p, i) => ({ id: p + verb, source: `${p} (${verb})`, target: fs[i], metadata: { grid: { row: p, col: verb } } })),
  )

const rng = seededRng(7)

function started(items: EngineItem[]): BattleshipState {
  const s = e.create({ items, settings: {} }, rng)
  e.join(s, 0)
  e.join(s, 1)
  e.apply(s, 0, { type: 'ready' }, rng)
  e.apply(s, 1, { type: 'ready' }, rng)
  return s
}

function shoot(s: BattleshipState, seat: number, [r, c]: [number, number], correct = true) {
  const answer = correct ? (s.cells[r]?.[c]?.expected ?? '') : 'definitely wrong'
  e.apply(s, seat, { type: 'shoot', row: r, col: c, answer }, rng)
}

function water(s: BattleshipState, seat: number): [number, number] {
  const opp = s.players[1 - seat]
  for (let r = 0; r < s.rows.length; r++)
    for (let c = 0; c < s.cols.length; c++) {
      const onShip = opp.ships.some((sh) => sh.some(([a, b]) => a === r && b === c))
      if (s.cells[r][c].usable && !onShip && s.players[seat].shots[r][c] === SHOT.none) return [r, c]
    }
  throw new Error('no water')
}

const code = (fn: () => void) => {
  try {
    fn()
  } catch (err) {
    return err instanceof RuleError ? err.code : String(err)
  }
  return null
}

describe('layout', () => {
  it('uses a 6×6 plain board, 5×5 for small lists', () => {
    const s = started(plain(20))
    expect([s.rows.length, s.cols.length, s.grid]).toEqual([6, 6, false])
    expect(s.cols[0]).toBe('A')
    expect(started(plain(4)).rows).toHaveLength(5)
  })

  it('builds a pronoun × verb grid from conjugation tables', () => {
    const s = started(conjugation())
    expect(s.grid).toBe(true)
    expect(s.rows).toEqual(pronouns)
    expect(s.cols).toEqual(['être', 'avoir', 'aller'])
    expect(s.cells[3][2]).toMatchObject({ question: 'nous (aller)', expected: 'allons' })
    expect(fleetFor(18)).toEqual([3, 2])
  })

  it('falls back to a plain board when the grid is too small', () => {
    expect(started(conjugation().slice(0, 6)).grid).toBe(false)
  })

  it('places ships on distinct usable cells', () => {
    for (let seed = 0; seed < 30; seed++) {
      const s = e.create({ items: conjugation(), settings: {} }, seededRng(seed))
      const ships = placeFleet(s.cells, s.fleet, seededRng(seed))
      const seen = new Set<string>()
      ships.forEach((ship, i) => {
        expect(ship).toHaveLength(s.fleet[i])
        for (const [r, c] of ship) {
          expect(s.cells[r][c].usable).toBe(true)
          expect(seen.has(`${r},${c}`)).toBe(false)
          seen.add(`${r},${c}`)
        }
      })
    }
  })
})

describe('rules', () => {
  it('goes waiting → placing → playing', () => {
    const s = e.create({ items: plain(10), settings: {} }, rng)
    e.join(s, 0)
    expect(s.phase).toBe('waiting')
    expect(code(() => e.apply(s, 0, { type: 'ready' }, rng))).toBe('WRONG_PHASE')
    e.join(s, 1)
    expect(s.phase).toBe('placing')
    e.apply(s, 0, { type: 'ready' }, rng)
    expect(code(() => e.apply(s, 0, { type: 'reshuffle' }, rng))).toBe('ALREADY_READY')
    e.apply(s, 1, { type: 'ready' }, rng)
    expect([s.phase, s.turn]).toEqual(['playing', 0])
  })

  it('wrong answers pass the turn without a shot; misses pass; hits keep the turn', () => {
    const s = started(plain(20))
    expect(code(() => shoot(s, 1, water(s, 1)))).toBe('NOT_YOUR_TURN')

    const p = water(s, 0)
    shoot(s, 0, p, false)
    expect(s.last).toMatchObject({ kind: 'wrong', expected: s.cells[p[0]][p[1]].expected })
    expect(s.players[0].shots[p[0]][p[1]]).toBe(SHOT.none)
    expect(s.turn).toBe(1)

    shoot(s, 1, water(s, 1))
    expect([s.last?.kind, s.turn]).toEqual(['miss', 0])

    const target = s.players[1].ships[0][0]
    shoot(s, 0, target)
    expect([s.last?.kind, s.turn]).toEqual(['hit', 0])
    expect(code(() => shoot(s, 0, target))).toBe('ALREADY_SHOT')
    expect(code(() => shoot(s, 0, [99, 0]))).toBe('INVALID_CELL')
  })

  it('sinks ships, finishes and starts a rematch with the loser', () => {
    const s = started(plain(20))
    for (const ship of s.players[1].ships) {
      ship.forEach((p, i) => {
        shoot(s, 0, p)
        if (i === ship.length - 1) expect(s.last?.kind).toBe('sunk')
      })
    }
    expect([s.phase, s.winner]).toEqual(['finished', 0])
    e.apply(s, 1, { type: 'rematch' }, rng)
    expect([s.phase, s.starter, s.winner]).toEqual(['placing', 1, -1])
    e.apply(s, 0, { type: 'ready' }, rng)
    e.apply(s, 1, { type: 'ready' }, rng)
    expect(s.turn).toBe(1)
  })

  it('views never contain answers or unsunk enemy ships', () => {
    const s = started(conjugation())
    const v = e.view(s, 0)
    expect(v.opponent.ships).toEqual([])
    expect(v.me.ships).toHaveLength(s.fleet.length)
    const json = JSON.stringify(v)
    expect(json).not.toContain('allons')
    expect(json).not.toContain('"expected"')

    for (const p of s.players[1].ships[0]) shoot(s, 0, p)
    expect(e.view(s, 0).opponent.ships).toHaveLength(1)
  })
})
