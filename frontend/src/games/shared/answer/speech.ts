import { reactive } from 'vue'
import { speechStatus } from '@/api/speech'
import { canRecord } from '@/lib/recorder'
import { t } from '@/i18n'

/**
 * Whether spoken answers can be offered: the browser can record (HTTPS/localhost with a
 * microphone API) and the speech service answers. Loaded once per page, shared by all inputs.
 */
export const speech = reactive({
  loaded: false,
  /** The speech service is reachable (or simulated in test mode). */
  service: false,
  /** Test mode without the ASR sidecar: typing stands in for speaking. */
  simulated: false,
  /** This browser/page may use the microphone. */
  browser: false,
})

let loading: Promise<void> | null = null

/** Loads the status once; safe to call repeatedly (e.g. from render functions). */
export function ensureSpeechStatus(): Promise<void> {
  loading ??= speechStatus().then((s) => {
    speech.service = s.available
    speech.simulated = !!s.simulated
    speech.browser = canRecord()
    speech.loaded = true
  })
  return loading
}

/** Spoken answers work right now: service up and (unless simulated) a microphone is usable. */
export function speechUsable(): boolean {
  return speech.service && (speech.simulated || speech.browser)
}

/** Explains to teachers why spoken answers might not work; null if they will. */
export function speechNote(): string | null {
  void ensureSpeechStatus()
  if (!speech.loaded) return null
  if (!speech.service) return t('speech.note.noService')
  if (speech.simulated) return t('speech.note.simulated')
  return t('speech.note.https')
}
