import { describe, expect, it } from 'vitest'
import { languageCode } from './languages'

describe('languageCode', () => {
  it('maps German, English and native names and codes', () => {
    expect(['Englisch', 'English', 'en', ' EN '].map(languageCode)).toEqual(['en', 'en', 'en', 'en'])
    expect(['Französisch', 'Franzoesisch', 'français', 'fr'].map(languageCode)).toEqual(['fr', 'fr', 'fr', 'fr'])
    expect(languageCode('Deutsch')).toBe('de')
  })

  it('uses the first word or primary subtag', () => {
    expect(languageCode('Deutsch (CH)')).toBe('de')
    expect(languageCode('en-GB')).toBe('en')
    expect(languageCode('Spanisch 2. Jahr')).toBe('es')
  })

  it('returns undefined for unknown or empty names', () => {
    expect([languageCode('Latein'), languageCode(''), languageCode(undefined)]).toEqual([undefined, undefined, undefined])
  })
})
