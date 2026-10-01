import { ApiError, isMockApi, request } from './client'

export interface SpeechStatus {
  available: boolean
  /** Test mode without a running ASR sidecar: the student types what they would have said. */
  simulated?: boolean
}

/**
 * Test mode talks to the ASR sidecar directly through the Vite proxy (/asr → :8765),
 * so real speech works on the laptop without the Go API. Without the sidecar the
 * spoken input falls back to a simulated text field.
 */
async function mockStatus(): Promise<SpeechStatus> {
  try {
    const res = await fetch('/asr/health')
    if (res.ok) return { available: true }
  } catch {
    // sidecar not running
  }
  return { available: true, simulated: true }
}

export async function speechStatus(): Promise<SpeechStatus> {
  if (isMockApi) return mockStatus()
  try {
    return await request<SpeechStatus>('GET', '/speech/status')
  } catch {
    return { available: false }
  }
}

export interface Transcript {
  /** Recognised text in the requested language (may be empty). */
  text: string
  /**
   * What a model that never translates heard. The language-steered model can turn
   * speech in another language into a translation, so the app compares this against
   * the question. Absent when no language was requested or the guard is disabled.
   */
  heard?: string | null
}

/**
 * Sends a 16 kHz mono WAV clip and returns the recognised text.
 * `language` (ISO 639-1, e.g. "de") tells the recogniser which language to expect.
 */
export async function transcribe(wav: Blob, language?: string): Promise<Transcript> {
  const query = language ? `?language=${encodeURIComponent(language)}` : ''
  let res: Response
  try {
    res = await fetch((isMockApi ? '/asr/transcribe' : '/api/transcribe') + query, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'audio/wav' },
      body: wav,
    })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'No connection to the server.')
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const code: string = data?.error?.code ?? 'SPEECH_UNAVAILABLE'
    throw new ApiError(res.status, code, data?.error?.message ?? 'Speech recognition is not available.')
  }
  return { text: String(data?.text ?? ''), heard: typeof data?.heard === 'string' ? data.heard : null }
}
