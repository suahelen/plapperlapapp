import type { Direction, VocabularyItem } from '../../types'
import { defaultRng, shuffle, type Rng } from '../random'
import { normalize } from './check'

/**
 * How a game asks for a word. Games create prompts; the answer components decide how
 * the prompt is presented and answered (typing, buttons, and later speech).
 */
export interface Prompt {
  item: VocabularyItem
  /** The word shown to the student. */
  question: string
  /** Which side of the item is expected as the answer. */
  expectedSide: 'source' | 'target'
  /** The answer that is expected. */
  expected: string
  questionLanguage?: string
  expectedLanguage?: string
}

export type AnswerMode = 'typed' | 'choice' | 'spoken'

export interface AnswerResult {
  correct: boolean
  given: string
  expected: string
}

export function makePrompt(item: VocabularyItem, direction: Direction, rng: Rng = defaultRng): Prompt {
  const forward = direction === 'source-to-target' || (direction === 'mixed' && rng() < 0.5)
  return forward
    ? {
        item,
        question: item.source,
        expectedSide: 'target',
        expected: item.target,
        questionLanguage: item.sourceLanguage,
        expectedLanguage: item.targetLanguage,
      }
    : {
        item,
        question: item.target,
        expectedSide: 'source',
        expected: item.source,
        questionLanguage: item.targetLanguage,
        expectedLanguage: item.sourceLanguage,
      }
}

/**
 * Builds shuffled answer options: the expected answer plus up to `count - 1` distinct
 * distractors taken from the same side of other vocabulary items.
 */
export function buildChoices(prompt: Prompt, pool: VocabularyItem[], count: number, rng: Rng = defaultRng): string[] {
  const answerSide = prompt.expectedSide
  const seen = new Set([normalize(prompt.expected)])
  const distractors: string[] = []
  for (const other of shuffle(pool, rng)) {
    if (distractors.length >= count - 1) break
    const text = other[answerSide]
    const key = normalize(text)
    if (other.id === prompt.item.id || seen.has(key)) continue
    seen.add(key)
    distractors.push(text)
  }
  return shuffle([prompt.expected, ...distractors], rng)
}
