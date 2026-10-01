import { onBeforeUnmount, ref, shallowRef } from 'vue'
import { errorMessage } from '@/api/client'
import {
  createRoom,
  isRoomGone,
  joinRoom,
  sendRoomAction,
  subscribeRoom,
  type RoomConnection,
  type RoomEnvelope,
  type RoomTicket,
} from '@/api/rooms'

// Tickets are kept per browser tab (sessionStorage): a reload reconnects to the same
// seat, while a second tab of the same browser can join as the other player.
const ticketKey = (code: string) => `plapperlapapp-room:${code.toUpperCase()}`

function loadTicket(code: string): RoomTicket | null {
  try {
    const raw = sessionStorage.getItem(ticketKey(code))
    return raw ? (JSON.parse(raw) as RoomTicket) : null
  } catch {
    return null
  }
}

function storeTicket(t: RoomTicket) {
  try {
    sessionStorage.setItem(ticketKey(t.code), JSON.stringify(t))
  } catch {
    // Without storage a reload simply starts over.
  }
}

/** Joins or creates a multiplayer room and keeps this player's live view of it. */
export function useRoom<V>(publicId: string, gameType: string) {
  const ticket = shallowRef<RoomTicket | null>(null)
  const envelope = shallowRef<RoomEnvelope<V> | null>(null)
  const connection = ref<RoomConnection | 'idle'>('idle')
  const error = ref('')
  const busy = ref(false)
  let unsubscribe: (() => void) | null = null

  function connect(t: RoomTicket) {
    unsubscribe?.()
    ticket.value = t
    storeTicket(t)
    unsubscribe = subscribeRoom<V>(
      t,
      (e) => {
        // Ignore stale envelopes (e.g. delivered out of order after a reconnect).
        if (!envelope.value || e.version >= envelope.value.version) envelope.value = e
      },
      (c) => (connection.value = c),
    )
  }

  /** Runs a request; resolves to false (with `error` set) if it failed. */
  async function run(fn: () => Promise<void>): Promise<boolean> {
    error.value = ''
    busy.value = true
    try {
      await fn()
      return true
    } catch (e) {
      error.value = errorMessage(e)
      if (isRoomGone(e)) connection.value = 'gone'
      return false
    } finally {
      busy.value = false
    }
  }

  const create = (name = '') => run(async () => connect(await createRoom(publicId, gameType, name)))

  /** Joins by code, or reconnects if this tab already has a seat in that room. */
  const join = (code: string, name = '') =>
    run(async () => {
      const existing = loadTicket(code)
      connect(existing ?? (await joinRoom(code, name)))
    })

  const send = (action: Record<string, unknown>) =>
    run(async () => {
      if (ticket.value) await sendRoomAction(ticket.value, action)
    })

  function leave() {
    unsubscribe?.()
    unsubscribe = null
    ticket.value = null
    envelope.value = null
    connection.value = 'idle'
    error.value = ''
  }

  onBeforeUnmount(() => unsubscribe?.())

  return { ticket, envelope, connection, error, busy, create, join, send, leave }
}

export type Room<V> = ReturnType<typeof useRoom<V>>
