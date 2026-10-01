import { afterAll, describe, expect, it } from 'vitest'
import { currentLocale, languageName, setLocale, t } from '.'

describe('switching languages', () => {
  afterAll(() => setLocale('de'))

  it('starts in German', () => {
    expect([currentLocale(), t('answer.correct'), t('games.kaboom.cup.go')]).toEqual(['de', '✓ Richtig!', 'Ziehen!'])
  })

  it('loads a language on demand, including every game catalogue', async () => {
    await setLocale('fr')
    expect(currentLocale()).toBe('fr')
    expect(t('answer.correct')).toBe('✓ Bonne réponse !')
    expect(t('games.kaboom.cup.go')).toBe('Tirer !')
    expect(t('games.eile-mit-weile.status.translate', { n: 3 }, 3)).toBe('Traduis correctement et tu avances de 3 cases.')
    expect(t('games.eile-mit-weile.status.translate', { n: 1 }, 1)).toBe('Traduis correctement et tu avances de 1 case.')
  })

  it('shows teacher-typed language names in the UI language', async () => {
    await setLocale('fr')
    expect([languageName('Englisch'), languageName('de'), languageName('Klingonisch')]).toEqual(['Anglais', 'Allemand', 'Klingonisch'])
    await setLocale('es')
    expect(languageName('Französisch')).toBe('Francés')
  })
})
