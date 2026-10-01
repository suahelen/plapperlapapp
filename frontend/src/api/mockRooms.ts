/**
 * Test-mode stand-in for the Go room hub (backend/internal/rooms), dev builds only.
 *
 * Room state lives in localStorage; every tab applies actions with the TypeScript
 * engine and announces changes over a BroadcastChannel, so two tabs of the same
 * browser can play against each other. The contract matches src/api/rooms.ts.
 */
import { ApiError } from './client'
import { mockRoomContent } from './mock'
import type { RoomConnection, RoomEnvelope, RoomTicket } from './rooms'
import { battleshipEngine } from '@/games/battleship/engine'
import { memoryRoomEngine } from '@/games/memory/roomEngine'
import { kaboomRoomEngine } from '@/games/kaboom/roomEngine'
import { eileRoomEngine } from '@/games/eile-mit-weile/roomEngine'
import { RuleError } from '@/games/shared/room/rules'
import { defaultRng } from '@/games/shared/random'

interface MockEngine<S> {
  maxPlayers: number
  create(content: { items: any[]; settings: Record<string, unknown> }, rng: () => number): S
  join(s: S, seat: number, name: string): void
  apply(s: S, seat: number, action: Record<string, unknown>, rng: () => number): void
  view(s: S, seat: number): unknown
}

const engines: Record<string, MockEngine<any>> = {
  battleship: battleshipEngine,
  memory: memoryRoomEngine,
  kaboom: kaboomRoomEngine,
  'eile-mit-weile': eileRoomEngine,
}

interface StoredRoom {
  gameType: string
  state: unknown
  tokens: string[]
  version: number
}

const PREFIX = 'plapperlapapp-mock-room:'
let channelInstance: BroadcastChannel | null | undefined

/** Created lazily. In Node (tests) it is unref'd, because an open channel keeps the process alive. */
function getChannel(): BroadcastChannel | null {
  if (channelInstance === undefined) {
    channelInstance = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('plapperlapapp-rooms') : null
    ;(channelInstance as { unref?: () => void } | null)?.unref?.()
  }
  return channelInstance
}
const localListeners = new Set<(code: string) => void>()
const HEARTBEAT_MS = 3000
const OFFLINE_AFTER_MS = 8000

const fail = (status: number, code: string, message: string): never => {
  throw new ApiError(status, code, message)
}

function loadRoom(code: string): StoredRoom {
  const raw = localStorage.getItem(PREFIX + code.toUpperCase())
  return raw ? (JSON.parse(raw) as StoredRoom) : fail(404, 'ROOM_NOT_FOUND', 'Room was not found. It may have expired.')
}

function saveRoom(code: string, room: StoredRoom) {
  localStorage.setItem(PREFIX + code, JSON.stringify(room))
  announce(code)
}

/** Notifies subscribers in other tabs (BroadcastChannel) and in this tab. */
function announce(code: string) {
  getChannel()?.postMessage(code)
  localListeners.forEach((l) => l(code)) // BroadcastChannel doesn't echo to the sending tab
}

const seenKey = (code: string, seat: number) => `${PREFIX}${code}:seen:${seat}`
const lastSeen = (code: string, seat: number) => Number(localStorage.getItem(seenKey(code, seat)) ?? 0)

function engineOf(room: StoredRoom) {
  return engines[room.gameType]
}

function randomString(alphabet: string, length: number) {
  return Array.from(crypto.getRandomValues(new Uint8Array(length)), (b) => alphabet[b % alphabet.length]).join('')
}

function seatOf(room: StoredRoom, token: string) {
  const seat = room.tokens.indexOf(token)
  return seat >= 0 ? seat : fail(403, 'INVALID_ROOM_TOKEN', 'You are not a player in this room.')
}

function wrapRule<T>(fn: () => T): T {
  try {
    return fn()
  } catch (e) {
    if (e instanceof RuleError) throw new ApiError(400, e.code, e.message)
    throw e
  }
}

export async function createRoom(publicId: string, gameType: string, name = ''): Promise<RoomTicket> {
  const engine = engines[gameType] ?? fail(400, 'NOT_A_MULTIPLAYER_GAME', "This game can't be played in a room.")
  const state = wrapRule(() => engine.create(mockRoomContent(publicId, gameType), defaultRng))
  wrapRule(() => engine.join(state, 0, name))
  const code = randomString('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 6)
  const token = randomString('abcdefghijklmnopqrstuvwxyz0123456789', 32)
  saveRoom(code, { gameType, state, tokens: [token], version: 1 })
  return { code, token, seat: 0 }
}

export async function joinRoom(rawCode: string, name = ''): Promise<RoomTicket> {
  const code = rawCode.trim().toUpperCase()
  const room = loadRoom(code)
  const engine = engineOf(room)
  if (room.tokens.length >= engine.maxPlayers) fail(409, 'ROOM_FULL', 'This room is already full.')
  const seat = room.tokens.length
  const token = randomString('abcdefghijklmnopqrstuvwxyz0123456789', 32)
  wrapRule(() => engine.join(room.state, seat, name))
  room.tokens.push(token)
  room.version++
  saveRoom(code, room)
  return { code, token, seat }
}

export async function sendRoomAction(ticket: RoomTicket, action: Record<string, unknown>): Promise<void> {
  const room = loadRoom(ticket.code)
  const seat = seatOf(room, ticket.token)
  wrapRule(() => engineOf(room).apply(room.state, seat, action, defaultRng))
  room.version++
  saveRoom(ticket.code, room)
}

export function subscribeRoom<V>(
  ticket: RoomTicket,
  onEnvelope: (e: RoomEnvelope<V>) => void,
  onConnection: (c: RoomConnection) => void,
): () => void {
  const code = ticket.code.toUpperCase()

  const push = () => {
    let room: StoredRoom
    try {
      room = loadRoom(code)
      seatOf(room, ticket.token)
    } catch {
      onConnection('gone')
      return
    }
    const seat = room.tokens.indexOf(ticket.token)
    const now = Date.now()
    const online = Array.from(
      { length: engineOf(room).maxPlayers },
      (_, i) => i === seat || now - lastSeen(code, i) < OFFLINE_AFTER_MS,
    )
    onEnvelope({ version: room.version, online, view: engineOf(room).view(room.state, seat) as V })
  }

  // Presence uses its own key per seat, so heartbeats never rewrite (and possibly
  // overwrite) the game state another tab has just saved.
  const heartbeat = () => {
    try {
      const room = loadRoom(code)
      const seat = room.tokens.indexOf(ticket.token)
      if (seat < 0) return
      const wasOffline = Date.now() - lastSeen(code, seat) >= OFFLINE_AFTER_MS
      localStorage.setItem(seenKey(code, seat), String(Date.now()))
      if (wasOffline) announce(code) // tell the other tab we're (back) online
    } catch {
      // room gone; push() reports it
    }
  }

  const onMessage = (c: string) => {
    if (c === code) push()
  }
  const onChannel = (e: MessageEvent) => onMessage(String(e.data))
  // Second instant path: browsers fire 'storage' in every other tab when localStorage changes.
  const onStorage = (e: StorageEvent) => {
    if (e.key === PREFIX + code) push()
  }

  getChannel()?.addEventListener('message', onChannel)
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  localListeners.add(onMessage)
  heartbeat()
  const beat = setInterval(() => {
    heartbeat()
    push() // also refreshes the other player's online status
  }, HEARTBEAT_MS)

  onConnection('open')
  push()

  return () => {
    clearInterval(beat)
    getChannel()?.removeEventListener('message', onChannel)
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
    localListeners.delete(onMessage)
  }
}
