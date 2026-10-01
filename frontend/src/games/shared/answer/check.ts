import leadWords from '../../../../../shared/lead-words.json'

/**
 * Sentence punctuation that never changes a vocabulary answer. Speech recognition adds it
 * ("Haus."), and students sometimes type it. Apostrophes and hyphens (l'arbre, grand-père) matter
 * and are kept; "/" and ";" separate alternatives.
 */
const PUNCTUATION = /[.,!?¡¿:"«»“”„…]/g
/** Typographic apostrophes (from speech recognition or phone keyboards) count as "'". */
const APOSTROPHES = /[’‘`´]/g

/**
 * Normalises an answer for comparison: no sentence punctuation, plain apostrophes, trimmed,
 * collapsed spaces, lowercase, NFC.
 */
export function normalize(s: string): string {
  return s
    .normalize('NFC')
    .replace(PUNCTUATION, ' ')
    .replace(APOSTROPHES, "'")
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

/**
 * Splits an expected answer into accepted alternatives. Teachers often write
 * "Haus / das Haus" or "big; large"; any single alternative is accepted, as is the full text.
 */
export function alternatives(expected: string): string[] {
  const parts = expected
    .split(/[/;]/)
    .map(normalize)
    .filter((p) => p !== '')
  return [normalize(expected), ...parts]
}

const LEAD = new Set(leadWords.words)

/**
 * Drops one allowed leading word ("vous allez" → "allez", "j'aime" → "aime"), or returns
 * null if the answer doesn't start with one.
 */
export function dropLeadWord(normalized: string): string | null {
  const space = normalized.indexOf(' ')
  const first = space < 0 ? normalized : normalized.slice(0, space)
  if (space > 0 && LEAD.has(first)) return normalized.slice(space + 1)
  for (const e of leadWords.elided) {
    if (first.length > e.length && first.startsWith(e)) return normalized.slice(e.length)
  }
  return null
}

/**
 * True if `given` matches `expected` or one of its alternatives. Pronouns and articles the
 * student adds in front are ignored ("vous allez" for "allez"), which matters for speech:
 * recognition is much more reliable on short phrases than on single words. Words the
 * expected answer contains are still required ("Hund" is wrong for "der Hund").
 */
export function isCorrect(given: string, expected: string): boolean {
  const accepted = alternatives(expected)
  let g: string | null = normalize(given)
  while (g) {
    if (accepted.includes(g)) return true
    g = dropLeadWord(g)
  }
  return false
}
