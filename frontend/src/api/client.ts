import { t, te } from '@/i18n'
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

/** True when running `npm run dev` in test mode: the API is simulated in the browser. */
export const isMockApi = import.meta.env.DEV && import.meta.env.VITE_MOCK_API === 'true'

/** Sends a JSON request to the API and returns the decoded response. */
export async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  if (isMockApi) {
    // Dynamic import: the mock is never part of a production build.
    const { mockRequest } = await import('./mock')
    return mockRequest<T>(method, path, body)
  }

  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Keine Verbindung zum Server.')
  }

  if (res.status === 204) return undefined as T

  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const err = data?.error
    throw new ApiError(res.status, err?.code ?? 'UNKNOWN', err?.message ?? `Anfrage fehlgeschlagen (${res.status}).`)
  }
  return data as T
}

/**
 * A message for the user in the current UI language: API errors are translated by code
 * (`errors.<CODE>` in the catalogues); unknown codes fall back to the server's text.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const key = `errors.${e.code}`
    return te(key) ? t(key) : e.message
  }
  return e instanceof Error ? e.message : String(e)
}
