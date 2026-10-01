import { describe, expect, it } from 'vitest'
import { saidQuestionInstead, similarity } from './spoken'
import type { Prompt } from './prompt'

const prompt = (question: string, expected: string): Prompt => ({
  item: { id: '1', source: question, target: expected },
  question,
  expected,
  expectedSide: 'target',
})

describe('similarity', () => {
  it('scores look-alike words high and different words low', () => {
    expect(similarity('House', 'Haus')).toBeGreaterThanOrEqual(0.5)
    expect(similarity('dog', 'Hund')).toBeLessThan(0.5)
    expect(similarity('the dog', 'der Hund')).toBeLessThan(0.5)
    expect(similarity('Hotel', 'hotel.')).toBe(1)
  })
})

describe('saidQuestionInstead', () => {
  it('flags reading the question aloud when the words differ', () => {
    // Canary (told "de") turned English speech into "Der Hund"; Parakeet heard "The dog."
    expect(saidQuestionInstead('The dog.', prompt('the dog', 'der Hund'))).toBe(true)
    expect(saidQuestionInstead('Cat', prompt('cat', 'die Katze'))).toBe(true)
  })

  it('accepts real answers and anything that is not the question', () => {
    expect(saidQuestionInstead('Der Hund.', prompt('the dog', 'der Hund'))).toBe(false)
    expect(saidQuestionInstead('Hunt.', prompt('the dog', 'der Hund'))).toBe(false)
    expect(saidQuestionInstead('', prompt('the dog', 'der Hund'))).toBe(false)
    expect(saidQuestionInstead(null, prompt('the dog', 'der Hund'))).toBe(false)
  })

  it('never flags look-alike pairs, which sound the same', () => {
    expect(saidQuestionInstead('House.', prompt('house', 'Haus'))).toBe(false)
  })

  it('handles alternatives in the question', () => {
    expect(saidQuestionInstead('large', prompt('big; large', 'gross'))).toBe(true)
  })
})
