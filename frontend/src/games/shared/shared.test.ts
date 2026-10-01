import { describe, expect, it } from 'vitest'
import { isCorrect, normalize } from './answer/check'
import { buildChoices, makePrompt } from './answer/prompt'
import { WordQueue } from './wordQueue'
import { seededRng, shuffle } from './random'
import { resolveSettings, validateSettings } from '../settings'
import { eileMitWeileGame } from '../eile-mit-weile/definition'
import type { VocabularyItem } from '../types'

const vocab: VocabularyItem[] = [
  { id: '1', source: 'house', target: 'Haus' },
  { id: '2', source: 'tree', target: 'Baum' },
  { id: '3', source: 'dog', target: 'Hund' },
  { id: '4', source: 'cat', target: 'Katze' },
  { id: '5', source: 'hound', target: 'Hund' },
]

describe('answer checking', () => {
  it('normalises whitespace and case', () => {
    expect(normalize('  Das   Haus ')).toBe('das haus')
    expect(isCorrect(' haus', 'Haus')).toBe(true)
    expect(isCorrect('HAUS', 'Haus')).toBe(true)
    expect(isCorrect('Hause', 'Haus')).toBe(false)
    expect(isCorrect('   ', 'Haus')).toBe(false)
  })

  it('accepts any alternative separated by / or ;', () => {
    expect(isCorrect('das Haus', 'Haus / das Haus')).toBe(true)
    expect(isCorrect('haus', 'Haus / das Haus')).toBe(true)
    expect(isCorrect('large', 'big; large')).toBe(true)
    expect(isCorrect('big; large', 'big; large')).toBe(true)
  })

  it('treats composed and decomposed umlauts the same', () => {
    expect(isCorrect('Müll', 'Müll')).toBe(true)
  })
})

describe('prompts and choices', () => {
  it('respects direction', () => {
    expect(makePrompt(vocab[0], 'source-to-target')).toMatchObject({ question: 'house', expected: 'Haus' })
    expect(makePrompt(vocab[0], 'target-to-source')).toMatchObject({ question: 'Haus', expected: 'house' })
  })

  it('builds distinct choices including the answer', () => {
    const rng = seededRng(1)
    for (let i = 0; i < 20; i++) {
      const p = makePrompt(vocab[2], 'source-to-target') // dog → Hund
      const choices = buildChoices(p, vocab, 4, rng)
      expect(choices).toHaveLength(4)
      expect(choices).toContain('Hund')
      expect(new Set(choices.map((c) => c.toLowerCase())).size).toBe(4) // "hound → Hund" not duplicated
    }
  })

  it('returns fewer choices when the vocabulary is small', () => {
    const p = makePrompt(vocab[0], 'source-to-target')
    expect(buildChoices(p, vocab.slice(0, 2), 4)).toHaveLength(2)
  })
})

describe('WordQueue', () => {
  it('uses every word once per pass', () => {
    const q = new WordQueue(vocab, seededRng(3))
    const ids = Array.from({ length: vocab.length }, () => q.next().id)
    expect(new Set(ids).size).toBe(vocab.length)
  })

  it('brings missed words back soon', () => {
    const q = new WordQueue(vocab, seededRng(4))
    const missed = q.next()
    q.retryLater(missed, 2)
    const upcoming = [q.next().id, q.next().id, q.next().id]
    expect(upcoming[2]).toBe(missed.id)
  })
})

describe('shuffle', () => {
  it('keeps all elements', () => {
    expect(shuffle([1, 2, 3, 4, 5], seededRng(9)).sort()).toEqual([1, 2, 3, 4, 5])
  })
})

describe('resolveSettings', () => {
  it('fills defaults and drops invalid or unknown values', () => {
    const s = resolveSettings(eileMitWeileGame, {
      direction: 'target-to-source',
      boardSize: 50,
      pawnsPerPlayer: 9,
      sixRollsAgain: false,
      evil: 'x',
    })
    expect(s).toEqual({
      direction: 'target-to-source',
      answerModes: ['typed'],
      boardSize: 48,
      pawnsPerPlayer: 1,
      sixRollsAgain: false,
    })
  })
})

describe('answer modes setting', () => {
  it('migrates the old single answerMode', () => {
    expect(resolveSettings(eileMitWeileGame, { answerMode: 'choice' }).answerModes).toEqual(['choice'])
    expect(resolveSettings(eileMitWeileGame, { answerMode: 'choice', answerModes: ['spoken'] }).answerModes).toEqual([
      'spoken',
    ])
    expect(resolveSettings(eileMitWeileGame, { answerMode: 'morse' }).answerModes).toEqual(['typed'])
  })

  it('accepts only non-empty lists of known modes without duplicates', () => {
    expect(resolveSettings(eileMitWeileGame, { answerModes: ['typed', 'spoken'] }).answerModes).toEqual(['typed', 'spoken'])
    for (const bad of [[], ['typed', 'typed'], ['telepathy'], 'typed']) {
      expect(validateSettings(eileMitWeileGame, { answerModes: bad })).toHaveLength(1)
    }
  })
})
