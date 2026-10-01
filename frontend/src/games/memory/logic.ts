import type { VocabularyItem } from '../types'
import { defaultRng, shuffle, type Rng } from '../shared/random'
import type { Card, MemoryState } from './types'

/** Picks up to `maxPairs` random words and lays out their source and target cards shuffled. */
export function createDeck(items: VocabularyItem[], maxPairs: number, rng: Rng = defaultRng): MemoryState {
  const chosen = shuffle(items, rng).slice(0, maxPairs)
  const cards: Card[] = shuffle(
    chosen.flatMap((item) => [
      { pairId: item.id, text: item.source, side: 'source' as const },
      { pairId: item.id, text: item.target, side: 'target' as const },
    ]),
    rng,
  ).map((c, i) => ({ ...c, id: i, matched: false }))
  return { cards, flipped: [], attempts: 0, matchedPairs: 0, totalPairs: chosen.length, finished: false }
}

/**
 * Turns a card face up. With two cards up, the attempt is counted: a match stays
 * revealed, otherwise both remain up until `hideUnmatched` is called.
 */
export function flip(state: MemoryState, index: number): MemoryState {
  const card = state.cards[index]
  if (!card || card.matched || state.flipped.includes(index) || state.flipped.length >= 2) return state

  const flipped = [...state.flipped, index]
  if (flipped.length < 2) return { ...state, flipped }

  const [a, b] = flipped.map((i) => state.cards[i])
  const attempts = state.attempts + 1
  if (a.pairId !== b.pairId) return { ...state, flipped, attempts }

  const cards = state.cards.map((c) => (c.pairId === a.pairId ? { ...c, matched: true } : c))
  const matchedPairs = state.matchedPairs + 1
  return { ...state, cards, flipped: [], attempts, matchedPairs, finished: matchedPairs === state.totalPairs }
}

export function hideUnmatched(state: MemoryState): MemoryState {
  return state.flipped.length === 2 ? { ...state, flipped: [] } : state
}
