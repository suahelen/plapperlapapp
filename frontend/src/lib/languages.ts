/**
 * Maps the free-text language names teachers type on a word list ("Englisch",
 * "Französisch", "French", "fr") to ISO 639-1 codes. Speech recognition uses the code to
 * transcribe single words in the right language; unknown names give undefined (the
 * recogniser then guesses).
 */
const CODES: Record<string, string[]> = {
  de: ['deutsch', 'german', 'allemand', 'tedesco', 'alemán', 'aleman'],
  en: ['englisch', 'english', 'anglais', 'inglese', 'inglés', 'ingles'],
  fr: ['französisch', 'franzoesisch', 'franzosisch', 'french', 'français', 'francais', 'francese', 'francés'],
  it: ['italienisch', 'italian', 'italien', 'italiano'],
  es: ['spanisch', 'spanish', 'espagnol', 'spagnolo', 'español', 'espanol'],
  pt: ['portugiesisch', 'portuguese', 'portugais', 'português', 'portugues'],
  nl: ['niederländisch', 'niederlaendisch', 'holländisch', 'dutch', 'nederlands', 'néerlandais'],
  sv: ['schwedisch', 'swedish', 'svenska'],
  da: ['dänisch', 'daenisch', 'danish', 'dansk'],
  fi: ['finnisch', 'finnish', 'suomi'],
  pl: ['polnisch', 'polish', 'polski'],
  cs: ['tschechisch', 'czech', 'čeština'],
  sk: ['slowakisch', 'slovak'],
  sl: ['slowenisch', 'slovenian', 'slovene'],
  hr: ['kroatisch', 'croatian', 'hrvatski'],
  hu: ['ungarisch', 'hungarian', 'magyar'],
  ro: ['rumänisch', 'rumaenisch', 'romanian', 'română'],
  bg: ['bulgarisch', 'bulgarian'],
  el: ['griechisch', 'greek', 'neugriechisch'],
  et: ['estnisch', 'estonian'],
  lv: ['lettisch', 'latvian'],
  lt: ['litauisch', 'lithuanian'],
  mt: ['maltesisch', 'maltese'],
  ru: ['russisch', 'russian', 'русский'],
  uk: ['ukrainisch', 'ukrainian', 'українська'],
}

/** Offered in the word-list editor; each maps to a code. */
export const LANGUAGE_SUGGESTIONS = [
  'Deutsch',
  'Englisch',
  'Französisch',
  'Italienisch',
  'Spanisch',
  'Portugiesisch',
  'Niederländisch',
  'Schwedisch',
  'Polnisch',
  'Russisch',
  'Ukrainisch',
]

const LOOKUP = new Map<string, string>()
for (const [code, names] of Object.entries(CODES)) {
  LOOKUP.set(code, code)
  for (const n of names) LOOKUP.set(n, code)
}

export function languageCode(name: string | undefined): string | undefined {
  if (!name) return undefined
  const key = name.normalize('NFC').trim().toLowerCase()
  // "Deutsch (CH)", "en-GB", "Französisch 2. Jahr" → first word / primary subtag
  return LOOKUP.get(key) ?? LOOKUP.get(key.split(/[\s(_-]/)[0])
}
