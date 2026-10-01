import { languageCode } from '@/lib/languages'
import { isLocale, type Locale } from '.'

interface ActivityLike {
  gameLanguage?: string
  vocabulary: { sourceLanguage?: string; targetLanguage?: string }[]
}

/**
 * The language games are shown in: the teacher's choice for the activity, otherwise the
 * language being learned – the word-list language that isn't German (the target side if
 * both aren't), otherwise German.
 */
export function gameLocale(activity: ActivityLike): Locale {
  if (isLocale(activity.gameLanguage)) return activity.gameLanguage
  return learnedLocale(activity.vocabulary) ?? 'de'
}

/** The supported non-German language of the word lists, if any. */
export function learnedLocale(items: ActivityLike['vocabulary']): Locale | undefined {
  for (const item of items) {
    const target = languageCode(item.targetLanguage)
    const source = languageCode(item.sourceLanguage)
    for (const code of [target, source]) {
      if (code && code !== 'de' && isLocale(code)) return code
    }
  }
  return undefined
}
