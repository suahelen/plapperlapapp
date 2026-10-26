import { describe, expect, it } from 'vitest'
import { canonicalKey, guessLetter, startRound } from './logic'
import { makePrompt } from '../shared/answer/prompt'
import type { VocabularyItem } from '../types'

const item: VocabularyItem = { id: '1', source: 'office', target: 'résumé' }
const withSpace: VocabularyItem = { id: '2', source: 'house', target: 'der Hund' }

describe('canonicalKey', () => {
  it('strips diacritics and lowercases', () => {
    expect(canonicalKey('é')).toBe('e')
    expect(canonicalKey('É')).toBe('e')
  })

  it('returns null for non a-z characters', () => {
    expect(canonicalKey('ß')).toBeNull()
    expect(canonicalKey(' ')).toBeNull()
    expect(canonicalKey('5')).toBeNull()
  })
})

describe('startRound', () => {
  it('masks letters and reveals free characters immediately', () => {
    const round = startRound(makePrompt(withSpace, 'source-to-target'))
    const spaceCell = round.cells.find((c) => c.char === ' ')!
    expect(spaceCell.revealed).toBe(true)
    expect(spaceCell.key).toBeNull()
    expect(round.cells.filter((c) => c.key !== null).every((c) => !c.revealed)).toBe(true)
    expect(round.status).toBe('playing')
  })
})

describe('guessLetter', () => {
  it('reveals every matching cell at once, including accented variants', () => {
    const round = startRound(makePrompt(item, 'source-to-target'))
    const next = guessLetter(round, 'e', 6)
    const eCells = next.cells.filter((c) => c.key === 'e')
    expect(eCells).toHaveLength(2)
    expect(eCells.every((c) => c.revealed)).toBe(true)
  })

  it('increments wrongGuesses on an incorrect letter', () => {
    const round = startRound(makePrompt(item, 'source-to-target'))
    const next = guessLetter(round, 'z', 6)
    expect(next.wrongGuesses).toBe(1)
    expect(next.status).toBe('playing')
    expect(next.cells).toBe(round.cells)
  })

  it('is a no-op for an already-guessed letter', () => {
    const round = startRound(makePrompt(item, 'source-to-target'))
    const next = guessLetter(round, 'z', 6)
    expect(guessLetter(next, 'z', 6)).toBe(next)
  })

  it('is a no-op once the round is no longer playing', () => {
    const round = startRound(makePrompt(item, 'source-to-target'))
    const lost = guessLetter(guessLetter(round, 'z', 1), 'q', 1)
    expect(lost.status).toBe('lost')
    expect(guessLetter(lost, 'a', 1)).toBe(lost)
  })

  it('wins once every letter is revealed, even with prior wrong guesses', () => {
    let round = startRound(makePrompt(item, 'source-to-target'))
    round = guessLetter(round, 'z', 6)
    for (const letter of ['r', 'e', 's', 'u', 'm']) round = guessLetter(round, letter, 6)
    expect(round.status).toBe('won')
    expect(round.wrongGuesses).toBe(1)
  })

  it('loses once wrongGuesses reaches maxMistakes', () => {
    let round = startRound(makePrompt(item, 'source-to-target'))
    round = guessLetter(round, 'z', 2)
    expect(round.status).toBe('playing')
    round = guessLetter(round, 'x', 2)
    expect(round.status).toBe('lost')
  })
})

describe('direction wiring', () => {
  it('builds the secret from the expected side per direction', () => {
    const forward = startRound(makePrompt(item, 'source-to-target'))
    expect(forward.cells.map((c) => c.char).join('')).toBe('résumé')

    const backward = startRound(makePrompt(item, 'target-to-source'))
    expect(backward.cells.map((c) => c.char).join('')).toBe('office')
  })
})
