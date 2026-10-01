import { ref } from 'vue'
import { isLocale, SUPPORTED, type Locale } from '@/i18n'

const KEY = 'uiLanguage'

function initial(): Locale {
  try {
    const saved = localStorage.getItem(KEY)
    if (isLocale(saved)) return saved
  } catch {
    // storage blocked: fall through to the browser language
  }
  const browser = typeof navigator !== 'undefined' ? navigator.language.slice(0, 2).toLowerCase() : ''
  return (SUPPORTED as readonly string[]).includes(browser) ? (browser as Locale) : 'de'
}

/** The teacher's UI language (teacher pages). Student pages use the activity's game language. */
export const teacherLocale = ref<Locale>(initial())

export function setTeacherLocale(locale: Locale) {
  teacherLocale.value = locale
  try {
    localStorage.setItem(KEY, locale)
  } catch {
    // not remembered in private mode
  }
}
