import type { Direction, VocabularyItem } from '../types'
import { buildChoices, makePrompt, type Prompt } from './answer/prompt'
import { defaultRng, shuffle, type Rng } from './random'

export interface QuizQuestion {
  prompt: Prompt
  choices?: string[]
}

/**
 * Builds a fixed list of questions: each word once in random order, repeating the
 * vocabulary if more questions than words are requested.
 */
export function buildQuiz(
  items: VocabularyItem[],
  opts: { count: number; direction: Direction; answerCount?: number },
  rng: Rng = defaultRng,
): QuizQuestion[] {
  const questions: QuizQuestion[] = []
  let pool: VocabularyItem[] = []
  while (questions.length < opts.count && items.length > 0) {
    if (pool.length === 0) pool = shuffle(items, rng)
    const prompt = makePrompt(pool.shift()!, opts.direction, rng)
    questions.push({
      prompt,
      choices: opts.answerCount ? buildChoices(prompt, items, opts.answerCount, rng) : undefined,
    })
  }
  return questions
}
