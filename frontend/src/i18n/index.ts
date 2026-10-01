/**
 * Internationalisation (vue-i18n).
 *
 * - App texts live in ./locales/<lang>.json, grouped by area (common, nav, vocab, …).
 * - Each game ships its own texts in games/<id>/i18n/<lang>.json; they are merged under
 *   `games.<id>` so games stay self-contained plugins.
 * - German is bundled (and the fallback); other languages load on first use.
 *
 * Teachers pick their UI language (stores/locale.ts); student pages switch to the game
 * language of the activity (gameLocale in ./gameLocale.ts).
 */
import { createI18n } from 'vue-i18n'
import de from './locales/de.json'
import { languageCode } from '@/lib/languages'

export const SUPPORTED = ['de', 'fr', 'en', 'it', 'es'] as const
export type Locale = (typeof SUPPORTED)[number]

/** Each language's own name, for pickers. */
export const LOCALE_NAMES: Record<Locale, string> = {
  de: 'Deutsch',
  fr: 'Français',
  en: 'English',
  it: 'Italiano',
  es: 'Español',
}

export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (SUPPORTED as readonly string[]).includes(v)

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- message trees are arbitrary JSON
type Messages = Record<string, any>

const gameIdOf = (path: string) => path.match(/games\/([^/]+)\/i18n\//)![1]

function withGames(app: Messages, games: Record<string, Messages>): Messages {
  const byId: Messages = {}
  for (const [path, messages] of Object.entries(games)) byId[gameIdOf(path)] = messages
  return { ...app, games: byId }
}

const germanGames = import.meta.glob<Messages>('../games/*/i18n/de.json', { eager: true, import: 'default' })
const appLoaders = import.meta.glob<Messages>('./locales/*.json', { import: 'default' })
const gameLoaders = import.meta.glob<Messages>('../games/*/i18n/*.json', { import: 'default' })

// Loosely typed on purpose: inferring the schema from the JSON catalogues is too deep for
// TypeScript. Key completeness is checked by i18n/catalogs.test.ts instead.
const messages: Record<string, Messages> = { de: withGames(de, germanGames) }

export const i18n = createI18n({
  legacy: false,
  locale: 'de' as string,
  fallbackLocale: 'de',
  messages,
  missingWarn: import.meta.env.DEV,
  fallbackWarn: false,
})

/** Translate outside components (stores, API client, helpers). */
export const t: (key: string, ...args: unknown[]) => string = i18n.global.t as never
/** Whether a message key exists in the current language. */
export const te: (key: string) => boolean = i18n.global.te as never

const loaded = new Set<Locale>(['de'])

async function load(locale: Locale): Promise<void> {
  if (loaded.has(locale)) return
  const app = await appLoaders[`./locales/${locale}.json`]()
  const games: Record<string, Messages> = {}
  await Promise.all(
    Object.entries(gameLoaders)
      .filter(([path]) => path.endsWith(`/${locale}.json`))
      .map(async ([path, loader]) => (games[path] = await loader())),
  )
  i18n.global.setLocaleMessage(locale, withGames(app, games) as never)
  loaded.add(locale)
}

/** Switches the UI language (loading its texts first) and updates <html lang>. */
export async function setLocale(locale: Locale): Promise<void> {
  await load(locale)
  i18n.global.locale.value = locale
  if (typeof document !== 'undefined') document.documentElement.lang = locale
}

export const currentLocale = (): Locale => i18n.global.locale.value as Locale

/**
 * A word list's language name ("Englisch", "fr") shown in the current UI language
 * ("anglais", "français"). Names that can't be recognised are shown as typed.
 */
export function languageName(name: string | undefined): string {
  if (!name) return ''
  const code = languageCode(name)
  if (!code) return name
  try {
    const shown = new Intl.DisplayNames([currentLocale()], { type: 'language' }).of(code)
    return shown ? shown.charAt(0).toLocaleUpperCase(currentLocale()) + shown.slice(1) : name
  } catch {
    return name
  }
}
