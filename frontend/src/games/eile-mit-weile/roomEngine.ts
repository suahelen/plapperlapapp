/**
 * Multi-device Eile mit Weile for test mode only (src/api/mockRooms.ts). Mirrors
 * backend/internal/rooms/eilemitweile and reuses the single-device rules in ./logic.ts.
 * State must stay plain JSON (it lives in localStorage), so the word queue is a list of IDs.
 */
import type { VocabularyItem } from '../types'
import { isCorrect } from '../shared/answer/check'
import { makePrompt, type Prompt } from '../shared/answer/prompt'
import { randomInt, shuffle, type Rng } from '../shared/random'
import { RuleError, checkSkip, newRoster, rosterJoin, rosterStart, type Roster } from '../shared/room/rules'
import { toRoomPrompt } from '../shared/room/roomPrompt'
import { answer, choosePawn, createGame, movablePawns, rollDie } from './logic'
import type { BoardConfig, EileMitWeileSettings, GameState } from './types'
import type { EileRoomView } from './roomTypes'

const MIN_PLAYERS = 2
const SEAT_COLORS: Record<number, EileRoomView['players'][number]['color'][]> = {
  2: ['red', 'green'],
  3: ['red', 'blue', 'green'],
  4: ['red', 'blue', 'green', 'yellow'],
}

export interface EileRoomState {
  roster: Roster
  items: VocabularyItem[]
  direction: EileMitWeileSettings['direction']
  config: BoardConfig
  queue: string[]
  game: GameState | null
  prompt: Prompt | null
  starter: number
  last: EileRoomView['lastEvent']
  seq: number
}

function nextWord(s: EileRoomState, rng: Rng): VocabularyItem {
  if (s.queue.length === 0) s.queue = shuffle(s.items.map((i) => i.id), rng)
  const id = s.queue.shift()!
  return s.items.find((i) => i.id === id)!
}

function retryLater(s: EileRoomState, id: string, gap = 3) {
  s.queue = s.queue.filter((x) => x !== id)
  s.queue.splice(Math.min(gap, s.queue.length), 0, id)
}

function setup(s: EileRoomState) {
  const g = createGame(
    s.roster.names.map((name) => ({ name, isCpu: false })),
    s.config,
  )
  s.game = { ...g, current: s.starter }
  s.prompt = null
  s.last = null
}

function event(s: EileRoomState, seat: number, kind: NonNullable<EileRoomView['lastEvent']>['kind']) {
  s.last = { seq: ++s.seq, seat, kind, pawn: 0, from: 0, to: 0 }
  return s.last
}

function requireTurn(s: EileRoomState, seat: number, phase: GameState['phase']): GameState {
  const g = s.game
  if (!g || g.phase !== phase) throw new RuleError('WRONG_PHASE', "That's not possible right now.")
  if (seat !== g.current) throw new RuleError('NOT_YOUR_TURN', "It's not your turn.")
  return g
}

/** Records the move the rules just made (if any) as the last event. */
function recordMove(s: EileRoomState, seat: number, roll: number) {
  const m = s.game?.lastMove
  if (!m) return
  Object.assign(event(s, seat, 'move'), { roll, pawn: m.pawn, from: m.from, to: m.to, captured: m.captured })
}

export const eileRoomEngine = {
  maxPlayers: 4,

  create(content: { items: VocabularyItem[]; settings: Record<string, unknown> }): EileRoomState {
    if (content.items.length === 0) throw new RuleError('NO_VOCABULARY', 'This activity has no vocabulary.')
    const st = content.settings
    const board = [32, 48, 64].includes(Number(st.boardSize)) ? Number(st.boardSize) : 48
    const pawns = Number(st.pawnsPerPlayer)
    return {
      roster: newRoster(),
      items: content.items,
      direction: (st.direction as EileMitWeileSettings['direction']) ?? 'source-to-target',
      config: {
        trackLength: board,
        homeLength: 4,
        pawnsPerPlayer: Number.isInteger(pawns) && pawns >= 1 && pawns <= 4 ? pawns : 1,
        sixRollsAgain: st.sixRollsAgain !== false,
      },
      queue: [],
      game: null,
      prompt: null,
      starter: 0,
      last: null,
      seq: 0,
    }
  },

  join(s: EileRoomState, seat: number, name: string) {
    rosterJoin(s.roster, seat, name)
  },

  apply(s: EileRoomState, seat: number, action: Record<string, unknown>, rng: Rng) {
    switch (action.type) {
      case 'start':
        rosterStart(s.roster, seat, MIN_PLAYERS)
        return setup(s)

      case 'roll': {
        const g = requireTurn(s, seat, 'roll')
        const value = randomInt(1, 6, rng)
        s.game = rollDie(g, value)
        s.prompt = makePrompt(nextWord(s, rng), s.direction, rng)
        event(s, seat, 'roll').roll = value
        return
      }

      case 'answer': {
        const g = requireTurn(s, seat, 'answer')
        const roll = g.roll ?? 0
        const given = String(action.answer ?? '')
        const expected = s.prompt?.expected ?? ''
        const correct = isCorrect(given, expected)
        if (!correct && s.prompt) retryLater(s, s.prompt.item.id)
        s.game = answer(g, correct)
        s.prompt = null
        if (!correct) return void Object.assign(event(s, seat, 'wrong'), { given, expected, roll })
        if (s.game.phase === 'choose-pawn') return void (event(s, seat, 'correct').roll = roll)
        return recordMove(s, seat, roll)
      }

      case 'choose': {
        const g = requireTurn(s, seat, 'choose-pawn')
        const pawn = Number(action.pawn)
        if (!movablePawns(g).includes(pawn)) throw new RuleError('INVALID_PAWN', "This pawn can't move.")
        s.game = choosePawn(g, pawn)
        return recordMove(s, seat, g.roll ?? 0)
      }

      case 'skip': {
        const g = s.game
        if (!g || !['roll', 'answer', 'choose-pawn'].includes(g.phase)) throw new RuleError('WRONG_PHASE', 'The game is not running.')
        checkSkip(seat, g.current)
        event(s, g.current, 'skip')
        const next = (g.current + 1) % g.players.length
        s.game = { ...g, phase: 'roll', roll: null, current: next, turn: next === s.starter ? g.turn + 1 : g.turn }
        s.prompt = null
        return
      }

      case 'rematch':
        if (s.game?.phase !== 'finished') throw new RuleError('WRONG_PHASE', 'The game is not over yet.')
        s.starter = (s.starter + 1) % s.roster.names.length
        return setup(s)
    }
    throw new RuleError('INVALID_ACTION', 'Unknown action.')
  },

  view(s: EileRoomState, seat: number): EileRoomView {
    const g = s.game
    const colors = SEAT_COLORS[Math.max(s.roster.names.length, MIN_PLAYERS)] ?? SEAT_COLORS[4]
    return {
      phase: g ? g.phase : 'lobby',
      you: seat,
      turn: g?.current ?? 0,
      round: g?.turn ?? 1,
      minPlayers: MIN_PLAYERS,
      trackLength: s.config.trackLength,
      homeLength: s.config.homeLength,
      pawnsPerPlayer: s.config.pawnsPerPlayer,
      sixRollsAgain: s.config.sixRollsAgain,
      players: s.roster.names.map((name, i) => {
        const p = g?.players[i]
        return { name, color: p?.color ?? colors[i], pawns: p?.pawns ?? [], correct: p?.correct ?? 0, answered: p?.answered ?? 0 }
      }),
      roll: g?.roll ?? 0,
      prompt: g?.phase === 'answer' && s.prompt ? toRoomPrompt(s.prompt) : null,
      movable: g?.phase === 'choose-pawn' ? movablePawns(g) : [],
      winner: g?.winner ?? -1,
      lastEvent: s.last,
    }
  },
}
