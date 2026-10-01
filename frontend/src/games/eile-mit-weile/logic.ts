/**
 * Simplified "Eile mit Weile" rules as a pure state machine.
 *
 *  roll ─▶ answer ─┬─ wrong ─────────────────────────────▶ next player
 *                  └─ correct ─▶ (choose-pawn) ─▶ move ─┬▶ next player
 *                                                        ├▶ same player again on a 6
 *                                                        └▶ finished
 *
 * Rules kept deliberately simple for classroom use:
 *  - Pawns start in the stall; any correct answer moves them out (the start field is step 1).
 *  - Landing on an opponent's pawn sends it back to its stall, except on a safe "Bänkli" field.
 *  - A pawn that would overshoot the goal stops on the goal.
 *  - The first player with all pawns at the goal wins.
 */
import type { Rng } from '../shared/random'
import type { BoardConfig, GameState, MoveEvent, Player, PlayerColor } from './types'

export const COLORS: PlayerColor[] = ['red', 'blue', 'green', 'yellow']
export interface PlayerSetup {
  name?: string
  isCpu: boolean
}

/** Board seat for each player count, so that 2 players sit opposite each other. */
const SEATS: Record<number, number[]> = { 1: [0], 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] }

export function createGame(setup: PlayerSetup[], config: BoardConfig): GameState {
  if (setup.length < 1 || setup.length > 4) throw new Error('1–4 players required')
  const seats = SEATS[setup.length]
  return {
    config,
    players: setup.map(
      (p, i): Player => ({
        color: COLORS[seats[i]],
        name: p.name ?? '', // unnamed players are shown by their colour (in the UI language)
        isCpu: p.isCpu,
        pawns: Array(config.pawnsPerPlayer).fill(-1),
        correct: 0,
        answered: 0,
      }),
    ),
    current: 0,
    phase: 'roll',
    roll: null,
    winner: null,
    lastMove: null,
    turn: 1,
  }
}

export const goalOf = (c: BoardConfig) => c.trackLength + c.homeLength - 1

/** The board seat (0–3) determines where a colour's start field is. */
export const seatOf = (color: PlayerColor) => COLORS.indexOf(color)

export const startFieldOf = (color: PlayerColor, c: BoardConfig) => (seatOf(color) * c.trackLength) / 4

/** Absolute track field for a pawn's progress, or null if it's in the stall or home stretch. */
export function trackField(color: PlayerColor, progress: number, c: BoardConfig): number | null {
  if (progress < 0 || progress >= c.trackLength) return null
  return (startFieldOf(color, c) + progress) % c.trackLength
}

/** Safe fields: every eighth of the track, which includes all four start fields. */
export function isSafeField(field: number, c: BoardConfig): boolean {
  return field % (c.trackLength / 8) === 0
}

export function rollDie(state: GameState, value: number): GameState {
  if (state.phase !== 'roll') return state
  if (!Number.isInteger(value) || value < 1 || value > 6) throw new Error('invalid die value')
  return { ...state, phase: 'answer', roll: value, lastMove: null }
}

/** Pawn indices of the current player that can still move. */
export function movablePawns(state: GameState): number[] {
  const goal = goalOf(state.config)
  const pawns = state.players[state.current].pawns
  const result: number[] = []
  const seen = new Set<number>()
  pawns.forEach((p, i) => {
    // Pawns on the same spot are interchangeable; offer only one of them.
    if (p < goal && !seen.has(p)) {
      seen.add(p)
      result.push(i)
    }
  })
  return result
}

export function answer(state: GameState, correct: boolean): GameState {
  if (state.phase !== 'answer') return state
  const players = state.players.map((p, i) =>
    i === state.current ? { ...p, answered: p.answered + 1, correct: p.correct + (correct ? 1 : 0) } : p,
  )
  const next = { ...state, players }
  if (!correct) return endTurn(next, false)

  const movable = movablePawns(next)
  if (movable.length === 0) return endTurn(next, false)
  if (movable.length === 1) return movePawn(next, movable[0])
  return { ...next, phase: 'choose-pawn' }
}

export function choosePawn(state: GameState, pawn: number): GameState {
  if (state.phase !== 'choose-pawn' || !movablePawns(state).includes(pawn)) return state
  return movePawn(state, pawn)
}

function movePawn(state: GameState, pawnIndex: number): GameState {
  const c = state.config
  const roll = state.roll!
  const me = state.players[state.current]
  const from = me.pawns[pawnIndex]
  const to = Math.min(from + roll, goalOf(c))

  const move: MoveEvent = { player: state.current, pawn: pawnIndex, from, to, captured: [] }
  const field = trackField(me.color, to, c)

  const players = state.players.map((p, pi) => {
    if (pi === state.current) {
      return { ...p, pawns: p.pawns.map((v, i) => (i === pawnIndex ? to : v)) }
    }
    if (field === null || isSafeField(field, c)) return p
    const pawns = p.pawns.map((v, i) => {
      if (trackField(p.color, v, c) === field) {
        move.captured.push({ player: pi, pawn: i, from: v })
        return -1
      }
      return v
    })
    return { ...p, pawns }
  })

  const goal = goalOf(c)
  const next: GameState = { ...state, players, lastMove: move }
  if (players[state.current].pawns.every((p) => p === goal)) {
    return { ...next, phase: 'finished', winner: state.current }
  }
  return endTurn(next, roll === 6 && c.sixRollsAgain)
}

function endTurn(state: GameState, again: boolean): GameState {
  if (again) return { ...state, phase: 'roll', roll: null }
  return {
    ...state,
    phase: 'roll',
    roll: null,
    current: (state.current + 1) % state.players.length,
    turn: state.current + 1 === state.players.length ? state.turn + 1 : state.turn,
  }
}

/**
 * Computer choice: capture if possible, otherwise bring a new pawn out,
 * otherwise advance the pawn that is furthest behind.
 */
export function cpuPickPawn(state: GameState): number {
  const c = state.config
  const me = state.players[state.current]
  const movable = movablePawns(state)
  const roll = state.roll ?? 1
  const capture = movable.find((i) => {
    const field = trackField(me.color, Math.min(me.pawns[i] + roll, goalOf(c)), c)
    if (field === null || isSafeField(field, c)) return false
    return state.players.some(
      (p, pi) => pi !== state.current && p.pawns.some((v) => trackField(p.color, v, c) === field),
    )
  })
  if (capture !== undefined) return capture
  const inStall = movable.find((i) => me.pawns[i] === -1)
  if (inStall !== undefined) return inStall
  return movable.reduce((best, i) => (me.pawns[i] < me.pawns[best] ? i : best), movable[0])
}

/** Whether the computer answers correctly this turn. */
export function cpuAnswers(rng: Rng, accuracy = 0.7): boolean {
  return rng() < accuracy
}

/** Intermediate progress values for animating a move step by step. */
export function movePath(from: number, to: number): number[] {
  const path: number[] = []
  for (let p = from + 1; p <= to; p++) path.push(p)
  return path
}
