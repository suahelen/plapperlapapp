import { isCorrect, normalize } from './check'
import type { Prompt } from './prompt'

/** Levenshtein-based similarity of two normalised strings: 1 = identical, 0 = nothing alike. */
export function similarity(a: string, b: string): number {
  const x = normalize(a)
  const y = normalize(b)
  if (!x.length && !y.length) return 1
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j)
  for (let i = 1; i <= x.length; i++) {
    const row = [i]
    for (let j = 1; j <= y.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1))
    }
    prev = row
  }
  return 1 - prev[y.length] / Math.max(x.length, y.length)
}

/**
 * The speech model that is told the expected language also translates: reading the
 * question aloud ("the dog") can come back as the answer ("Der Hund"). `heard` is the
 * transcript of a model that never translates. If it is the question – and question and
 * answer are clearly different words – the student said the question instead of the
 * translation. Look-alike pairs (house/Haus) sound the same and are never flagged.
 */
export function saidQuestionInstead(heard: string | null | undefined, prompt: Prompt): boolean {
  if (!heard) return false
  if (isCorrect(heard, prompt.expected)) return false
  if (!isCorrect(heard, prompt.question)) return false
  return similarity(prompt.question, prompt.expected) < 0.5
}
