/**
 * TypeScript port of backend/internal/rooms/battleship, used ONLY by test mode
 * (src/api/mockRooms.ts) to simulate the server in the browser. The Go engine is
 * authoritative in production; keep both in sync (their tests cover the same rules).
 *
 * State is plain JSON so it can live in localStorage and be shared between tabs.
 */
import { isCorrect } from '../shared/answer/check'
import { shuffle, type Rng } from '../shared/random'
import type { BattleshipView, CellView, ShotEvent } from './types'
import { SHOT } from './types'

import { RuleError } from '../shared/room/rules'

export { RuleError }

export interface EngineItem {
  id: string
  source: string
  target: string
  sourceLanguage?: string
  targetLanguage?: string
  metadata?: Record<string, unknown>
}

interface Cell extends CellView {
  expected?: string
}

type Pos = [number, number]

interface PlayerState {
  joined: boolean
  ready: boolean
  ships: Pos[][]
  shots: number[][]
}

export interface BattleshipState {
  rows: string[]
  cols: string[]
  grid: boolean
  cells: Cell[][]
  fleet: number[]
  players: [PlayerState, PlayerState]
  phase: BattleshipView['phase']
  turn: number
  starter: number
  winner: number
  last: ShotEvent | null
  seq: number
}

const MAX_GRID_AXIS = 8
const MIN_USABLE_CELLS = 12

// --- board ------------------------------------------------------------------------

function gridOf(item: EngineItem): { row: string; col: string } | null {
  const g = item.metadata?.grid as { row?: unknown; col?: unknown } | undefined
  return g && typeof g.row === 'string' && typeof g.col === 'string' && g.row && g.col ? { row: g.row, col: g.col } : null
}

function gridLayout(items: EngineItem[]) {
  const rows: string[] = []
  const cols: string[] = []
  const placed: { r: number; c: number; item: EngineItem }[] = []
  for (const item of items) {
    const g = gridOf(item)
    if (!g) continue
    let r = rows.indexOf(g.row)
    if (r < 0) {
      if (rows.length >= MAX_GRID_AXIS) continue
      r = rows.push(g.row) - 1
    }
    let c = cols.indexOf(g.col)
    if (c < 0) {
      if (cols.length >= MAX_GRID_AXIS) continue
      c = cols.push(g.col) - 1
    }
    placed.push({ r, c, item })
  }
  const cells: Cell[][] = rows.map(() => cols.map(() => ({ usable: false })))
  for (const { r, c, item } of placed) {
    if (cells[r][c].usable) continue
    cells[r][c] = {
      usable: true,
      itemId: item.id,
      question: item.source,
      expected: item.target,
      expectedSide: 'target',
      questionLang: item.sourceLanguage,
      expectedLang: item.targetLanguage,
    }
  }
  return { rows, cols, cells, grid: true }
}

function plainLayout(items: EngineItem[], direction: string, rng: Rng) {
  const side = items.length < 15 ? 5 : 6
  const rows = Array.from({ length: side }, (_, i) => String(i + 1))
  const cols = Array.from({ length: side }, (_, i) => String.fromCharCode(65 + i))
  let deck: EngineItem[] = []
  const next = () => {
    if (deck.length === 0) deck = shuffle(items, rng)
    return deck.shift()!
  }
  const cells: Cell[][] = rows.map(() =>
    cols.map(() => {
      const it = next()
      const forward = direction !== 'target-to-source' && (direction !== 'mixed' || rng() < 0.5)
      return forward
        ? { usable: true, itemId: it.id, question: it.source, expected: it.target, expectedSide: 'target' as const,
            questionLang: it.sourceLanguage, expectedLang: it.targetLanguage }
        : { usable: true, itemId: it.id, question: it.target, expected: it.source, expectedSide: 'source' as const,
            questionLang: it.targetLanguage, expectedLang: it.sourceLanguage }
    }),
  )
  return { rows, cols, cells, grid: false }
}

const usableCount = (cells: Cell[][]) => cells.flat().filter((c) => c.usable).length

export function fleetFor(usable: number): number[] {
  if (usable >= 36) return [4, 3, 2, 2]
  if (usable >= 25) return [3, 2, 2]
  return [3, 2]
}

export function placeFleet(cells: Cell[][], sizes: number[], rng: Rng): Pos[][] {
  for (const spacing of [true, false]) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const ships = tryPlace(cells, sizes, spacing, rng)
      if (ships) return ships
    }
  }
  const singles: Pos[][] = []
  cells.forEach((row, r) =>
    row.forEach((c, col) => {
      if (c.usable && singles.length < sizes.length) singles.push([[r, col]])
    }),
  )
  return singles
}

function tryPlace(cells: Cell[][], sizes: number[], spacing: boolean, rng: Rng): Pos[][] | null {
  const rows = cells.length
  const cols = cells[0]?.length ?? 0
  const taken = new Set<string>()
  const key = (r: number, c: number) => `${r},${c}`
  const touches = (r: number, c: number) => {
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (taken.has(key(r + dr, c + dc))) return true
    return false
  }
  const ships: Pos[][] = []
  for (const size of sizes) {
    let placed = false
    for (let t = 0; t < 200 && !placed; t++) {
      const horizontal = rng() < 0.5
      const r0 = Math.floor(rng() * rows)
      const c0 = Math.floor(rng() * cols)
      const ship: Pos[] = []
      for (let k = 0; k < size; k++) {
        const [r, c] = horizontal ? [r0, c0 + k] : [r0 + k, c0]
        if (r >= rows || c >= cols || !cells[r][c].usable || taken.has(key(r, c)) || (spacing && touches(r, c))) break
        ship.push([r, c])
      }
      if (ship.length === size) {
        ship.forEach(([r, c]) => taken.add(key(r, c)))
        ships.push(ship)
        placed = true
      }
    }
    if (!placed) return null
  }
  return ships
}

// --- engine ------------------------------------------------------------------------

export const battleshipEngine = {
  maxPlayers: 2,

  create(content: { items: EngineItem[]; settings: Record<string, unknown> }, rng: Rng): BattleshipState {
    const direction = typeof content.settings.direction === 'string' ? content.settings.direction : ''
    let layout = gridLayout(content.items)
    if (usableCount(layout.cells) < MIN_USABLE_CELLS) {
      if (content.items.length === 0) throw new RuleError('NO_VOCABULARY', 'This activity has no vocabulary.')
      layout = plainLayout(content.items, direction, rng)
    }
    const empty = (): PlayerState => ({ joined: false, ready: false, ships: [], shots: [] })
    const s: BattleshipState = {
      ...layout,
      fleet: fleetFor(usableCount(layout.cells)),
      players: [empty(), empty()],
      phase: 'waiting',
      turn: 0,
      starter: 0,
      winner: -1,
      last: null,
      seq: 0,
    }
    resetBoards(s, rng)
    return s
  },

  join(s: BattleshipState, seat: number, _name?: string) {
    s.players[seat].joined = true
    if (s.phase === 'waiting' && s.players.every((p) => p.joined)) s.phase = 'placing'
  },

  apply(s: BattleshipState, seat: number, action: Record<string, unknown>, rng: Rng) {
    const me = s.players[seat]
    switch (action.type) {
      case 'reshuffle':
        if (s.phase !== 'placing' && s.phase !== 'waiting')
          throw new RuleError('WRONG_PHASE', 'Ships can only be moved before the game starts.')
        if (me.ready) throw new RuleError('ALREADY_READY', 'You are already ready.')
        me.ships = placeFleet(s.cells, s.fleet, rng)
        return
      case 'ready':
        if (s.phase !== 'placing') throw new RuleError('WRONG_PHASE', 'Wait for the second player.')
        me.ready = true
        if (s.players.every((p) => p.ready)) {
          s.phase = 'playing'
          s.turn = s.starter
        }
        return
      case 'shoot':
        return shoot(s, seat, Number(action.row), Number(action.col), String(action.answer ?? ''))
      case 'rematch':
        if (s.phase !== 'finished') throw new RuleError('WRONG_PHASE', 'The game is not over yet.')
        s.starter = 1 - s.winner
        resetBoards(s, rng)
        s.phase = 'placing'
        return
    }
    throw new RuleError('INVALID_ACTION', 'Unknown action.')
  },

  view(s: BattleshipState, seat: number): BattleshipView {
    const me = s.players[seat]
    const opp = s.players[1 - seat]
    return {
      phase: s.phase,
      you: seat,
      turn: s.turn,
      winner: s.winner,
      rows: s.rows,
      cols: s.cols,
      grid: s.grid,
      // Expected answers are never part of a view.
      cells: s.cells.map((row) => row.map(({ expected: _, ...cell }) => cell)),
      fleet: s.fleet,
      lastEvent: s.last,
      me: { joined: me.joined, ready: me.ready, ships: me.ships, shots: me.shots },
      opponent: {
        joined: opp.joined,
        ready: opp.ready,
        ships: opp.ships.filter((ship) => s.phase === 'finished' || isSunk(ship, me.shots)),
        shots: opp.shots,
      },
    }
  },
}

function shoot(s: BattleshipState, seat: number, row: number, col: number, answer: string) {
  if (s.phase !== 'playing') throw new RuleError('WRONG_PHASE', 'The game is not running.')
  if (seat !== s.turn) throw new RuleError('NOT_YOUR_TURN', "It's not your turn.")
  const cell = s.cells[row]?.[col]
  if (!cell || !cell.usable) throw new RuleError('INVALID_CELL', "This field can't be targeted.")
  const me = s.players[seat]
  const opp = s.players[1 - seat]
  if (me.shots[row][col] !== SHOT.none) throw new RuleError('ALREADY_SHOT', 'You already fired at this field.')

  const ev: ShotEvent = { seq: ++s.seq, seat, row, col, kind: 'miss' }
  s.last = ev
  if (!isCorrect(answer, cell.expected ?? '')) {
    Object.assign(ev, { kind: 'wrong', given: answer, expected: cell.expected })
    s.turn = 1 - seat
    return
  }
  const ship = opp.ships.find((sh) => sh.some(([r, c]) => r === row && c === col))
  if (!ship) {
    me.shots[row][col] = SHOT.miss
    s.turn = 1 - seat
    return
  }
  me.shots[row][col] = SHOT.hit
  ev.kind = 'hit'
  if (isSunk(ship, me.shots)) {
    ev.kind = 'sunk'
    ship.forEach(([r, c]) => (me.shots[r][c] = SHOT.sunk))
    if (opp.ships.every((sh) => isSunk(sh, me.shots))) {
      s.phase = 'finished'
      s.winner = seat
    }
  }
}

function isSunk(ship: Pos[], shots: number[][]) {
  return ship.every(([r, c]) => shots[r][c] >= SHOT.hit)
}

function resetBoards(s: BattleshipState, rng: Rng) {
  for (const p of s.players) {
    p.ready = false
    p.ships = placeFleet(s.cells, s.fleet, rng)
    p.shots = s.rows.map(() => s.cols.map(() => SHOT.none))
  }
  s.winner = -1
  s.last = null
}
