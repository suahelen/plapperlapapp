import { ApiError, isMockApi, request } from './client'

/** Credentials for one player in a multiplayer room. */
export interface RoomTicket {
  code: string
  token: string
  seat: number
}

/** What the server pushes on every change: this player's view of the game. */
export interface RoomEnvelope<V> {
  version: number
  online: boolean[]
  view: V
}

export type RoomConnection = 'connecting' | 'open' | 'gone'

// In test mode rooms are simulated across browser tabs (src/api/mockRooms.ts).
const mock = () => import('./mockRooms')

export async function createRoom(publicId: string, gameType: string, name = ''): Promise<RoomTicket> {
  if (isMockApi) return (await mock()).createRoom(publicId, gameType, name)
  return request<RoomTicket>('POST', '/rooms', { publicId, gameType, name })
}

export async function joinRoom(code: string, name = ''): Promise<RoomTicket> {
  if (isMockApi) return (await mock()).joinRoom(code, name)
  return request<RoomTicket>('POST', `/rooms/${encodeURIComponent(code)}/join`, { name })
}

export async function sendRoomAction(ticket: RoomTicket, action: Record<string, unknown>): Promise<void> {
  if (isMockApi) return (await mock()).sendRoomAction(ticket, action)
  return request<void>('POST', `/rooms/${encodeURIComponent(ticket.code)}/actions`, action, {
    'X-Room-Token': ticket.token,
  })
}

/**
 * Receives live updates via Server-Sent Events. The browser reconnects automatically
 * after network hiccups; if the server rejects the stream (room expired, server
 * restarted), the connection is reported as 'gone'. Returns an unsubscribe function.
 */
export function subscribeRoom<V>(
  ticket: RoomTicket,
  onEnvelope: (e: RoomEnvelope<V>) => void,
  onConnection: (c: RoomConnection) => void,
): () => void {
  if (isMockApi) {
    let unsubscribe: (() => void) | null = null
    let cancelled = false
    mock().then((m) => {
      if (!cancelled) unsubscribe = m.subscribeRoom(ticket, onEnvelope, onConnection)
    })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }

  onConnection('connecting')
  const url = `/api/rooms/${encodeURIComponent(ticket.code)}/events?token=${encodeURIComponent(ticket.token)}`
  const source = new EventSource(url)
  source.onopen = () => onConnection('open')
  source.onmessage = (e) => onEnvelope(JSON.parse(e.data) as RoomEnvelope<V>)
  source.addEventListener('closed', () => {
    source.close()
    onConnection('gone')
  })
  source.onerror = () => {
    // CLOSED means the server refused the stream; otherwise the browser is retrying.
    onConnection(source.readyState === EventSource.CLOSED ? 'gone' : 'connecting')
  }
  return () => source.close()
}

export function isRoomGone(e: unknown): boolean {
  return e instanceof ApiError && (e.code === 'ROOM_NOT_FOUND' || e.code === 'INVALID_ROOM_TOKEN')
}
