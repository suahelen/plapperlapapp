import type { VocabularyItem } from '../types'
import { buildChoices, type Prompt } from '../shared/answer/prompt'
import { defaultRng, type Rng } from '../shared/random'
import { gridOf } from '@/lib/grid'
import type { CellView } from './types'

/**
 * Prompt for a board cell. The expected answer stays on the server, so `expected` is
 * only filled in when the vocabulary (which the student already has) contains it —
 * needed to build multiple-choice options.
 */
export function promptForCell(cell: CellView, vocabulary: VocabularyItem[]): Prompt {
  const item = vocabulary.find((v) => v.id === cell.itemId) ?? { id: cell.itemId ?? '', source: '', target: '' }
  const side = cell.expectedSide ?? 'target'
  return {
    item,
    question: cell.question ?? '',
    expectedSide: side,
    expected: item[side],
    questionLanguage: cell.questionLang,
    expectedLanguage: cell.expectedLang,
  }
}

/**
 * Answer options for choice mode. For conjugation tables the distractors are other
 * forms of the same verb (same column), which is where the learning happens.
 */
export function choicesForCell(prompt: Prompt, vocabulary: VocabularyItem[], count = 4, rng: Rng = defaultRng): string[] {
  const g = gridOf(prompt.item)
  const sameColumn = g ? vocabulary.filter((v) => gridOf(v)?.col === g.col) : []
  const pool = sameColumn.length >= count ? sameColumn : vocabulary
  return buildChoices(prompt, pool, count, rng)
}
