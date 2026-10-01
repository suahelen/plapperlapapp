// Mirrors backend/internal/rooms/kaboom/engine_test.go.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { kaboomRoomEngine as e, type KaboomRoomState } from './roomEngine'
import { RuleError } from '../shared/room/rules'
import { seededRng } from '../shared/random'

const items = [
  { id: 'a', source: 'dog', target: 'Hund' },
  { id: 'b', source: 'cat', target: 'Katze' },
  { id: 'c', source: 'bird', target: 'Vogel' },
]
const rng = seededRng(11)

function started(players: number, settings: Record<string, unknown> = { sticks: 10 }): KaboomRoomState {
  const s = e.create({ items, settings })
  for (let i = 0; i < players; i++) e.join(s, i, `P${i}`)
  e.apply(s, 0, { type: 'start' }, rng)
  return s
}
/** Puts a word stick or a KABOOM on top of the cup. */
function top(s: KaboomRoomState, kind: 'word' | 'kaboom') {
  const cup = s.game!.cup
  const i = cup.findIndex((x) => x.kind === kind)
  s.game = { ...s.game!, cup: [cup[i], ...cup.filter((_, j) => j !== i)] }
}
const act = (s: KaboomRoomState, seat: number, action: Record<string, unknown>) => e.apply(s, seat, action, rng)
const answerCorrectly = (s: KaboomRoomState, seat: number) => act(s, seat, { type: 'answer', answer: s.prompt!.expected })
const total = (s: KaboomRoomState) => s.game!.cup.length + s.game!.teams.reduce((n, t) => n + t.sticks.length, 0)
const code = (fn: () => void) => {
  try {
    fn()
  } catch (err) {
    return err instanceof RuleError ? err.code : String(err)
  }
  return null
}

afterEach(() => vi.useRealTimers())

describe('multi-device kaboom (test mode)', () => {
  it('keeps a correctly answered stick and passes the turn', () => {
    const s = started(2)
    expect(code(() => act(s, 1, { type: 'draw' }))).toBe('NOT_YOUR_TURN')
    top(s, 'word')
    act(s, 0, { type: 'draw' })
    expect(e.view(s, 1).prompt?.question).toBeTruthy()
    answerCorrectly(s, 0)
    expect([e.view(s, 0).players[0].sticks, e.view(s, 0).turn, e.view(s, 0).phase]).toEqual([1, 1, 'draw'])
  })

  it('returns a wrong answer to the cup and reveals the expected answer', () => {
    const s = started(2)
    top(s, 'word')
    act(s, 0, { type: 'draw' })
    const size = s.game!.cup.length
    act(s, 0, { type: 'answer', answer: 'definitely wrong' })
    expect(s.game!.cup.length).toBe(size + 1)
    expect(s.last).toMatchObject({ kind: 'wrong', expected: expect.any(String) })
  })

  it('KABOOM returns all sticks; the host may continue', () => {
    const s = started(2)
    const before = total(s)
    for (let i = 0; i < 3; i++) {
      top(s, 'word')
      act(s, s.game!.current, { type: 'draw' })
      answerCorrectly(s, s.game!.current)
    }
    top(s, 'kaboom')
    act(s, 1, { type: 'draw' })
    expect(s.last).toMatchObject({ kind: 'kaboom', lost: 1 })
    expect(total(s)).toBe(before)
    act(s, 0, { type: 'continue' })
    expect([s.game!.current, s.game!.phase]).toEqual([0, 'draw'])
  })

  it('hides the cup order and answers from the view', () => {
    const s = started(2)
    top(s, 'word')
    act(s, 0, { type: 'draw' })
    const json = JSON.stringify(e.view(s, 1))
    expect(json).not.toContain(`"${s.prompt!.expected}"`)
    expect(json).not.toContain('itemId":"a"') // nothing about the cup's contents
  })

  it('ends on time and rotates the starter on rematch', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const s = started(2, { sticks: 20, timeLimit: 5 })
    expect(code(() => act(s, 1, { type: 'timeUp' }))).toBe('NOT_YET')
    vi.setSystemTime(1_000_000 + 5 * 60_000 + 1000)
    act(s, 1, { type: 'timeUp' })
    expect(e.view(s, 0).phase).toBe('finished')
    act(s, 1, { type: 'rematch' })
    expect([s.game!.current, e.view(s, 0).wordsLeft]).toEqual([1, 20])
  })

  it('lets the host skip and puts the drawn stick back', () => {
    const s = started(3)
    top(s, 'word')
    act(s, 0, { type: 'draw' })
    act(s, 0, { type: 'answer', answer: 'x' }) // → P1
    top(s, 'word')
    act(s, 1, { type: 'draw' })
    const size = s.game!.cup.length
    expect(code(() => act(s, 2, { type: 'skip' }))).toBe('NOT_HOST')
    act(s, 0, { type: 'skip' })
    expect([s.game!.current, s.game!.cup.length, s.game!.teams[1].answered]).toEqual([2, size + 1, 0])
  })
})
