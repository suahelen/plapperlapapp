import { describe, expect, it } from 'vitest'
import { createDeck, flip, hideUnmatched } from './logic'
import { seededRng } from '../shared/random'
import type { VocabularyItem } from '../types'

const vocab: VocabularyItem[] = [
  { id: '1', source: 'house', target: 'Haus' },
  { id: '2', source: 'tree', target: 'Baum' },
  { id: '3', source: 'dog', target: 'Hund' },
]

const pairOf = (s: ReturnType<typeof createDeck>, pairId: string) =>
  s.cards.flatMap((c, i) => (c.pairId === pairId ? [i] : []))

describe('memory', () => {
  it('deals two cards per pair, limited to maxPairs', () => {
    const s = createDeck(vocab, 2, seededRng(1))
    expect(s.cards).toHaveLength(4)
    expect(s.totalPairs).toBe(2)
    expect(createDeck(vocab, 10).cards).toHaveLength(6)
  })

  it('matches pairs and finishes', () => {
    let s = createDeck(vocab, 3, seededRng(2))
    for (const item of vocab) {
      const [a, b] = pairOf(s, item.id)
      s = flip(flip(s, a), b)
    }
    expect(s).toMatchObject({ matchedPairs: 3, attempts: 3, finished: true, flipped: [] })
  })

  it('keeps a mismatch face up until hidden and ignores extra flips', () => {
    let s = createDeck(vocab, 3, seededRng(3))
    const [a] = pairOf(s, '1')
    const [b, c] = pairOf(s, '2')
    s = flip(flip(s, a), b)
    expect(s.flipped).toEqual([a, b])
    expect(s.attempts).toBe(1)
    expect(flip(s, c)).toBe(s)
    s = hideUnmatched(s)
    expect(s.flipped).toEqual([])
  })

  it('ignores flipping the same or a matched card', () => {
    let s = createDeck(vocab, 3, seededRng(4))
    const [a, b] = pairOf(s, '3')
    s = flip(s, a)
    expect(flip(s, a)).toBe(s)
    s = flip(s, b)
    expect(flip(s, a)).toBe(s)
  })
})
