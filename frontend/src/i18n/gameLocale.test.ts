import { describe, expect, it } from 'vitest'
import { gameLocale, learnedLocale } from './gameLocale'

const items = (source?: string, target?: string) => [{ sourceLanguage: source, targetLanguage: target }]

describe('game language', () => {
  it('uses the language being learned (the side that is not German)', () => {
    expect(gameLocale({ vocabulary: items('Englisch', 'Deutsch') })).toBe('en')
    expect(gameLocale({ vocabulary: items('Deutsch', 'Französisch') })).toBe('fr')
    expect(gameLocale({ vocabulary: items('Französisch', '') })).toBe('fr')
  })

  it('prefers the target side when neither language is German', () => {
    expect(learnedLocale(items('English', 'Spanisch'))).toBe('es')
  })

  it('falls back to German for German-only, unknown or unsupported languages', () => {
    expect(gameLocale({ vocabulary: items('Deutsch', 'Deutsch') })).toBe('de')
    expect(gameLocale({ vocabulary: items('Latein', 'Deutsch') })).toBe('de')
    expect(gameLocale({ vocabulary: items('Niederländisch', 'Deutsch') })).toBe('de') // no game texts in Dutch
    expect(gameLocale({ vocabulary: [] })).toBe('de')
  })

  it("respects the teacher's choice for the activity", () => {
    expect(gameLocale({ gameLanguage: 'de', vocabulary: items('Französisch', 'Deutsch') })).toBe('de')
    expect(gameLocale({ gameLanguage: 'it', vocabulary: items('Englisch', 'Deutsch') })).toBe('it')
    expect(gameLocale({ gameLanguage: 'xx', vocabulary: items('Englisch', 'Deutsch') })).toBe('en')
  })
})
