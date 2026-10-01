import { beforeEach, describe, expect, it } from 'vitest'
import { createRoom, joinRoom, sendRoomAction, subscribeRoom } from './mockRooms'
import { resetMockDb } from './mock'
import type { RoomEnvelope } from './rooms'
import type { BattleshipView } from '@/games/battleship/types'
import type { MemoryRoomView } from '@/games/memory/roomTypes'

const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
} as Storage

beforeEach(() => {
  store.clear()
  resetMockDb()
})

describe('test-mode rooms', () => {
  it('lets two players join, place and shoot, with live views', async () => {
    const a = await createRoom('DEMO2345', 'battleship')
    const views: RoomEnvelope<BattleshipView>[] = []
    const stop = subscribeRoom<BattleshipView>(a, (e) => views.push(e), () => {})
    expect(views.at(-1)?.view.phase).toBe('waiting')

    const b = await joinRoom(a.code.toLowerCase())
    expect(b.seat).toBe(1)
    expect(views.at(-1)?.view.phase).toBe('placing')
    await expect(joinRoom(a.code)).rejects.toMatchObject({ code: 'ROOM_FULL' })

    await sendRoomAction(a, { type: 'ready' })
    await sendRoomAction(b, { type: 'ready' })
    const v = views.at(-1)!.view
    expect(v.phase).toBe('playing')
    expect(v.you).toBe(0)
    expect(v.opponent.ships).toEqual([])

    await expect(sendRoomAction(b, { type: 'shoot', row: 0, col: 0, answer: 'x' })).rejects.toMatchObject({
      code: 'NOT_YOUR_TURN',
    })
    await sendRoomAction(a, { type: 'shoot', row: 0, col: 0, answer: 'definitely wrong' })
    expect(views.at(-1)?.view.lastEvent).toMatchObject({ kind: 'wrong', seat: 0 })
    expect(views.at(-1)?.view.turn).toBe(1)

    await expect(sendRoomAction({ ...a, token: 'forged' }, { type: 'ready' })).rejects.toMatchObject({
      code: 'INVALID_ROOM_TOKEN',
    })
    stop()
  })

  it('rejects unknown rooms and single-player games', async () => {
    await expect(joinRoom('ZZZZZZ')).rejects.toMatchObject({ code: 'ROOM_NOT_FOUND' })
    await expect(createRoom('DEMO2345', 'typing')).rejects.toMatchObject({ code: 'NOT_A_MULTIPLAYER_GAME' })
  })

  it('runs a 3-player lobby game (Memory) with names, start and late-join rejection', async () => {
    const host = await createRoom('DEMO2345', 'memory', 'Lena')
    const views: RoomEnvelope<MemoryRoomView>[] = []
    const stop = subscribeRoom<MemoryRoomView>(host, (e) => views.push(e), () => {})
    const b = await joinRoom(host.code, 'Tim')
    await expect(sendRoomAction(b, { type: 'start' })).rejects.toMatchObject({ code: 'NOT_HOST' })
    await joinRoom(host.code, '  ')
    expect(views.at(-1)?.view.players.map((p) => p.name)).toEqual(['Lena', 'Tim', ''])

    await sendRoomAction(host, { type: 'start' })
    expect(views.at(-1)?.view.phase).toBe('playing')
    await expect(joinRoom(host.code, 'Late')).rejects.toMatchObject({ code: 'GAME_STARTED' })

    await sendRoomAction(host, { type: 'flip', index: 0 })
    expect(views.at(-1)?.view.cards[0].faceUp).toBe(true)
    stop()
  })
})
