import { describe, expect, it } from 'vitest'
import { acknowledgeKaboom, answer, createGame, draw, finish, kaboomCount, ranking, wordSticksInCup } from './logic'
import { seededRng } from '../shared/random'
import type { KaboomState, Stick } from './types'
import type { VocabularyItem } from '../types'

const vocab: VocabularyItem[] = [
  { id: 'a', source: 'dog', target: 'Hund' },
  { id: 'b', source: 'cat', target: 'Katze' },
  { id: 'c', source: 'bird', target: 'Vogel' },
]
const teams = [
  { name: 'Rot', color: 'red' },
  { name: 'Blau', color: 'blue' },
]

function game(sticks = 10) {
  return createGame(teams, vocab, { sticks, kaboomShare: 'medium' }, seededRng(1))
}

/** Puts a specific stick on top of the cup. */
function withTop(s: KaboomState, kind: Stick['kind']): KaboomState {
  const i = s.cup.findIndex((x) => x.kind === kind)
  const cup = [s.cup[i], ...s.cup.filter((_, j) => j !== i)]
  return { ...s, cup }
}

describe('setup', () => {
  it('fills the cup with word sticks and KABOOMs', () => {
    const s = game(20)
    expect(wordSticksInCup(s)).toBe(20)
    expect(s.cup.filter((x) => x.kind === 'kaboom')).toHaveLength(kaboomCount(20, 'medium'))
    // Words cycle through the vocabulary.
    const ids = s.cup.flatMap((x) => (x.kind === 'word' ? [x.itemId] : []))
    expect(new Set(ids)).toEqual(new Set(['a', 'b', 'c']))
  })

  it('always has at least one KABOOM', () => {
    expect(kaboomCount(3, 'low')).toBe(1)
    expect(kaboomCount(30, 'high')).toBe(8)
  })
})

describe('turns', () => {
  it('keeps a correctly answered stick and passes the turn', () => {
    let s = draw(withTop(game(), 'word'))
    expect(s.phase).toBe('answer')
    const size = s.cup.length
    s = answer(s, true)
    expect(s.teams[0].sticks).toHaveLength(1)
    expect(s.teams[0]).toMatchObject({ correct: 1, answered: 1 })
    expect(s.cup).toHaveLength(size)
    expect(s).toMatchObject({ current: 1, phase: 'draw', drawn: null })
  })

  it('returns a wrongly answered stick to the cup', () => {
    let s = draw(withTop(game(), 'word'))
    const size = s.cup.length
    s = answer(s, false)
    expect(s.teams[0].sticks).toHaveLength(0)
    expect(s.cup).toHaveLength(size + 1)
    expect(s.current).toBe(1)
  })

  it('KABOOM puts all of the team’s sticks back, including the KABOOM', () => {
    let s = game()
    s = answer(draw(withTop(s, 'word')), true) // Rot: 1
    s = answer(draw(withTop(s, 'word')), true) // Blau: 1
    s = answer(draw(withTop(s, 'word')), true) // Rot: 2
    s = draw(withTop(s, 'kaboom')) // Blau draws KABOOM
    expect(s.phase).toBe('kaboom')
    expect(s.lost).toBe(1)
    expect(s.teams[1]).toMatchObject({ sticks: [], kabooms: 1 })
    expect(s.teams[0].sticks).toHaveLength(2)
    const total = s.cup.length + s.teams.reduce((n, t) => n + t.sticks.length, 0)
    expect(total).toBe(game().cup.length) // no stick is lost
    s = acknowledgeKaboom(s)
    expect(s).toMatchObject({ current: 0, phase: 'draw' })
  })

  it('ignores actions in the wrong phase', () => {
    const s = game()
    expect(answer(s, true)).toBe(s)
    expect(acknowledgeKaboom(s)).toBe(s)
    const drawn = draw(withTop(s, 'word'))
    expect(draw(drawn)).toBe(drawn)
  })
})

describe('end of game', () => {
  it('finishes when no word sticks are left in the cup', () => {
    let s = game(2)
    while (s.phase !== 'finished') {
      s = s.cup[0].kind === 'kaboom' ? acknowledgeKaboom(draw(s)) : answer(draw(s), true)
      // Avoid endless KABOOM loops in the test by only drawing word sticks once kabooms repeat.
      if (s.phase === 'draw') s = withTop(s, 'word')
    }
    expect(wordSticksInCup(s)).toBe(0)
  })

  it('ranks teams by sticks with shared ranks for ties', () => {
    let s = game()
    s = answer(draw(withTop(s, 'word')), true)
    expect(ranking(s).map((r) => [r.team.name, r.rank])).toEqual([
      ['Rot', 1],
      ['Blau', 2],
    ])
    s = answer(draw(withTop(s, 'word')), true)
    expect(ranking(finish(s)).map((r) => r.rank)).toEqual([1, 1])
  })
})
