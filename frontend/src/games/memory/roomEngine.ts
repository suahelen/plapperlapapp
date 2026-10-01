/**
 * Multi-device Memory for test mode only (src/api/mockRooms.ts). Mirrors
 * backend/internal/rooms/memory and reuses the single-device rules in ./logic.ts.
 */
import type { VocabularyItem } from '../types'
import type { Rng } from '../shared/random'
import { RuleError, checkSkip, newRoster, rosterJoin, rosterStart, type Roster } from '../shared/room/rules'
import { createDeck, flip, hideUnmatched } from './logic'
import type { MemoryState } from './types'
import type { MemoryRoomView } from './roomTypes'

const MIN_PLAYERS = 2

export interface MemoryRoomState {
  roster: Roster
  items: VocabularyItem[]
  pairs: number
  deck: MemoryState | null
  owners: number[]
  scores: number[]
  turn: number
  starter: number
  phase: MemoryRoomView['phase']
  pendingHide: boolean
  last: MemoryRoomView['lastEvent']
  seq: number
}

function deal(s: MemoryRoomState, rng: Rng) {
  s.deck = createDeck(s.items, s.pairs, rng)
  s.owners = s.deck.cards.map(() => -1)
  s.scores = s.roster.names.map(() => 0)
  s.turn = s.starter
  s.phase = 'playing'
  s.pendingHide = false
  s.last = null
}

function event(s: MemoryRoomState, seat: number, kind: NonNullable<MemoryRoomView['lastEvent']>['kind'], cards?: number[]) {
  s.last = { seq: ++s.seq, seat, kind, cards }
}

const nextTurn = (s: MemoryRoomState) => (s.turn = (s.turn + 1) % s.roster.names.length)

export const memoryRoomEngine = {
  maxPlayers: 4,

  create(content: { items: VocabularyItem[]; settings: Record<string, unknown> }): MemoryRoomState {
    const p = Number(content.settings.pairs)
    if (content.items.length < 2) throw new RuleError('NOT_ENOUGH_WORDS', 'Memory needs at least 2 words.')
    return {
      roster: newRoster(),
      items: content.items,
      pairs: Number.isInteger(p) && p >= 2 && p <= 15 ? p : 8,
      deck: null,
      owners: [],
      scores: [],
      turn: 0,
      starter: 0,
      phase: 'lobby',
      pendingHide: false,
      last: null,
      seq: 0,
    }
  },

  join(s: MemoryRoomState, seat: number, name: string) {
    rosterJoin(s.roster, seat, name)
  },

  apply(s: MemoryRoomState, seat: number, action: Record<string, unknown>, rng: Rng) {
    switch (action.type) {
      case 'start':
        rosterStart(s.roster, seat, MIN_PLAYERS)
        deal(s, rng)
        return
      case 'flip':
        return flipCard(s, seat, Number(action.index))
      case 'skip':
        if (s.phase !== 'playing') throw new RuleError('WRONG_PHASE', 'The game is not running.')
        checkSkip(seat, s.turn)
        if (s.deck) s.deck = { ...s.deck, flipped: [] }
        s.pendingHide = false
        event(s, s.turn, 'skip')
        nextTurn(s)
        return
      case 'rematch':
        if (s.phase !== 'finished') throw new RuleError('WRONG_PHASE', 'The game is not over yet.')
        s.starter = (s.starter + 1) % s.roster.names.length
        deal(s, rng)
        return
    }
    throw new RuleError('INVALID_ACTION', 'Unknown action.')
  },

  view(s: MemoryRoomState, seat: number): MemoryRoomView {
    const deck = s.deck
    const best = Math.max(...s.scores, 0)
    return {
      phase: s.phase,
      you: seat,
      turn: s.turn,
      minPlayers: MIN_PLAYERS,
      players: s.roster.names.map((name, i) => ({ name, score: s.scores[i] ?? 0 })),
      cards: (deck?.cards ?? []).map((c, i) => {
        const faceUp = c.matched || deck!.flipped.includes(i)
        return faceUp
          ? { faceUp, matched: c.matched, owner: s.owners[i], text: c.text, side: c.side }
          : { faceUp, matched: false, owner: -1 }
      }),
      winners: s.phase === 'finished' ? s.scores.flatMap((sc, i) => (sc === best ? [i] : [])) : [],
      lastEvent: s.last,
    }
  },
}

function flipCard(s: MemoryRoomState, seat: number, index: number) {
  if (s.phase !== 'playing' || !s.deck) throw new RuleError('WRONG_PHASE', 'The game is not running.')
  if (seat !== s.turn) throw new RuleError('NOT_YOUR_TURN', "It's not your turn.")
  if (s.pendingHide) {
    s.deck = hideUnmatched(s.deck)
    s.pendingHide = false
  }
  const before = s.deck
  const after = flip(before, index)
  if (after === before) throw new RuleError('INVALID_CARD', 'This card is already face up.')
  s.deck = after

  if (after.flipped.length === 1) return event(s, seat, 'flip', after.flipped)
  if (after.flipped.length === 2) {
    // Mismatch: both stay visible until the next flip; the turn passes.
    s.pendingHide = true
    event(s, seat, 'mismatch', [...after.flipped])
    nextTurn(s)
    return
  }
  // Match: the player keeps the turn.
  const pairId = after.cards[index].pairId
  const pair = after.cards.flatMap((c, i) => (c.pairId === pairId ? [i] : []))
  pair.forEach((i) => (s.owners[i] = seat))
  s.scores[seat]++
  event(s, seat, 'match', pair)
  if (after.finished) s.phase = 'finished'
}
