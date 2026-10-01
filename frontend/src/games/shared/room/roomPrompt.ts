import type { VocabularyItem } from '../../types'
import type { Prompt } from '../answer/prompt'

/** A prompt as sent by the server: never includes the expected answer. */
export interface RoomPrompt {
  itemId: string
  question: string
  expectedSide: 'source' | 'target'
  questionLang?: string
  expectedLang?: string
}

/** Strips the answer from a local prompt (used by the test-mode room engines). */
export function toRoomPrompt(p: Prompt): RoomPrompt {
  return {
    itemId: p.item.id,
    question: p.question,
    expectedSide: p.expectedSide,
    questionLang: p.questionLanguage,
    expectedLang: p.expectedLanguage,
  }
}

/**
 * Rebuilds a Prompt for PromptCard/AnswerInput from a server prompt. `expected` is
 * filled from the vocabulary the student already has, which choice mode needs.
 */
export function fromRoomPrompt(p: RoomPrompt, vocabulary: VocabularyItem[]): Prompt {
  const item = vocabulary.find((v) => v.id === p.itemId) ?? { id: p.itemId, source: '', target: '' }
  return {
    item,
    question: p.question,
    expectedSide: p.expectedSide,
    expected: item[p.expectedSide],
    questionLanguage: p.questionLang,
    expectedLanguage: p.expectedLang,
  }
}
