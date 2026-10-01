import { describe, expect, it } from 'vitest'
import { createGame, escape, finish, hasNextRound, makeRound, startRound, tap } from './logic'
import { seededRng } from '../shared/random'
import type { BalloonPopSettings } from './types'
import type { VocabularyItem } from '../types'

const vocab: VocabularyItem[] = [
  { id: '1', source: 'house', target: 'Haus' },
  { id: '2', source: 'tree', target: 'Baum' },
  { id: '3', source: 'dog', target: 'Hund' },
  { id: '4', source: 'cat', target: 'Katze' },
  { id: '5', source: 'bird', target: 'Vogel' },
]

const settings: BalloonPopSettings = { direction: 'source-to-target', balloonCount: 4, lives: 2, speed: 'normal', rounds: 3 }

function started() {
  const round = makeRound(vocab[0], vocab, settings, 1, seededRng(1))
  return startRound(createGame(settings), round)
}
const correctId = (s: ReturnType<typeof started>) => s.round!.balloons.find((b) => b.correct)!.id
const wrongId = (s: ReturnType<typeof started>) => s.round!.balloons.find((b) => !b.correct)!.id

describe('makeRound', () => {
  it('creates one correct balloon among distinct options in separate lanes', () => {
    const r = makeRound(vocab[2], vocab, settings, 1, seededRng(2))
    expect(r.balloons).toHaveLength(4)
    expect(r.balloons.filter((b) => b.correct).map((b) => b.text)).toEqual(['Hund'])
    expect(new Set(r.balloons.map((b) => b.text)).size).toBe(4)
    expect(new Set(r.balloons.map((b) => b.x)).size).toBe(4)
    expect(r.balloons.every((b) => b.x >= 12 && b.x <= 88)).toBe(true)
  })

  it('gets faster with the speed factor', () => {
    expect(makeRound(vocab[0], vocab, settings, 0.5).duration).toBeLessThan(makeRound(vocab[0], vocab, settings, 1).duration)
  })
})

describe('tapping', () => {
  it('scores a hit and ends the round', () => {
    let s = started()
    s = tap(s, correctId(s))
    expect(s).toMatchObject({ score: 1, streak: 1, phase: 'round-over', outcome: 'hit', lives: 2 })
    expect(s.speedFactor).toBeLessThan(1)
  })

  it('costs a life for a wrong balloon but keeps the round going', () => {
    let s = started()
    s = tap(s, wrongId(s))
    expect(s).toMatchObject({ lives: 1, phase: 'playing', streak: 0, mistakes: 1 })
    // Tapping the same popped balloon again does nothing.
    expect(tap(s, s.round!.balloons.find((b) => b.popped)!.id)).toBe(s)
  })

  it('ends the game when all lives are gone', () => {
    let s = started()
    const wrong = s.round!.balloons.filter((b) => !b.correct)
    s = tap(s, wrong[0].id)
    s = tap(s, wrong[1].id)
    expect(s).toMatchObject({ lives: 0, phase: 'finished' })
  })
})

describe('escaping', () => {
  it('costs a life and ends the round', () => {
    const s = escape(started())
    expect(s).toMatchObject({ lives: 1, phase: 'round-over', outcome: 'escaped' })
    expect(escape(s)).toBe(s) // ignored outside of play
  })
})

describe('rounds', () => {
  it('stops after the configured number of rounds', () => {
    let s = createGame(settings)
    for (let i = 0; i < 3; i++) {
      s = startRound(s, makeRound(vocab[i], vocab, settings, 1))
      s = tap(s, s.round!.balloons.find((b) => b.correct)!.id)
      expect(hasNextRound(s)).toBe(i < 2)
    }
    expect(finish(s).phase).toBe('finished')
    expect(s.score).toBe(3)
  })
})
