import type { Prompt } from '../shared/answer/prompt'

export interface LetterCell {
  /** Original character, keeping case and diacritics for display. */
  char: string
  /** Canonical a-z guess key; null for "free" characters revealed from the start. */
  key: string | null
  revealed: boolean
}

export interface RoundState {
  prompt: Prompt
  cells: LetterCell[]
  /** Canonical a-z keys guessed so far, right and wrong. */
  guessed: string[]
  wrongGuesses: number
  status: 'playing' | 'won' | 'lost'
}

/**
 * Maps one character to the a-z key that guesses it: lowercase, diacritics stripped.
 * Returns null for anything that isn't a plain a-z letter once stripped (spaces,
 * punctuation, digits, letters with no latin base like "ß").
 */
export function canonicalKey(ch: string): string | null {
  const stripped = ch
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  return /^[a-z]$/.test(stripped) ? stripped : null
}

/** Builds a fresh round from a prompt: free characters start revealed. */
export function startRound(prompt: Prompt): RoundState {
  const cells: LetterCell[] = [...prompt.expected].map((char) => {
    const key = canonicalKey(char)
    return { char, key, revealed: key === null }
  })
  const status = cells.every((c) => c.revealed) ? 'won' : 'playing'
  return { prompt, cells, guessed: [], wrongGuesses: 0, status }
}

/**
 * Pure transition: a no-op (same reference) if the round isn't 'playing', the letter
 * isn't a plain a-z key, or it was already guessed. A correct guess reveals every cell
 * matching that key (so one guess can reveal several accented occurrences at once).
 */
export function guessLetter(round: RoundState, letter: string, maxMistakes: number): RoundState {
  if (round.status !== 'playing') return round
  const key = canonicalKey(letter)
  if (key === null || round.guessed.includes(key)) return round

  const guessed = [...round.guessed, key]
  const matched = round.cells.some((c) => c.key === key)

  if (!matched) {
    const wrongGuesses = round.wrongGuesses + 1
    const status = wrongGuesses >= maxMistakes ? 'lost' : 'playing'
    return { ...round, guessed, wrongGuesses, status }
  }

  const cells = round.cells.map((c) => (c.key === key ? { ...c, revealed: true } : c))
  const status = cells.every((c) => c.revealed) ? 'won' : 'playing'
  return { ...round, cells, guessed, status }
}
