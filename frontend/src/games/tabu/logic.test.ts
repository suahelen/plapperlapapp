import { describe, expect, it } from 'vitest'
import {
  createGame,
  isLastTurn,
  makeTabuWord,
  markCorrect,
  markSkip,
  nextPlayer,
  showWord,
  startTurn,
  tick,
  winner,
} from './logic'
import type { VocabularyItem } from '../types'

const dog: VocabularyItem = { id: '1', source: 'dog', target: 'Hund' }
const same: VocabularyItem = { id: '2', source: 'Taxi', target: 'Taxi' }

describe('createGame', () => {
  it('starts every player at zero with no word showing', () => {
    const state = createGame(['Ana', 'Ben'])
    expect(state.scores).toEqual([0, 0])
    expect(state.describerIndex).toBe(0)
    expect(state.word).toBeNull()
  })
})

describe('makeTabuWord', () => {
  it('bans both the target word and its translation', () => {
    expect(makeTabuWord(dog).taboo).toEqual(['Hund', 'dog'])
  })

  it('does not duplicate a taboo word when source and target are identical', () => {
    expect(makeTabuWord(same).taboo).toEqual(['Taxi'])
  })
})

describe('turn flow', () => {
  it('startTurn resets the per-turn counters and sets the timer', () => {
    const state = startTurn(createGame(['Ana', 'Ben']), makeTabuWord(dog), 60)
    expect(state.secondsLeft).toBe(60)
    expect(state.correctThisTurn).toBe(0)
    expect(state.skippedThisTurn).toBe(0)
    expect(state.word?.item.id).toBe('1')
  })

  it('markCorrect scores the current describer and clears the word', () => {
    let state = startTurn(createGame(['Ana', 'Ben']), makeTabuWord(dog), 60)
    state = markCorrect(state)
    expect(state.scores).toEqual([1, 0])
    expect(state.correctThisTurn).toBe(1)
    expect(state.word).toBeNull()
  })

  it('markSkip counts the skip without scoring', () => {
    let state = startTurn(createGame(['Ana', 'Ben']), makeTabuWord(dog), 60)
    state = markSkip(state)
    expect(state.scores).toEqual([0, 0])
    expect(state.skippedThisTurn).toBe(1)
    expect(state.word).toBeNull()
  })

  it('showWord reveals the next word without touching scores', () => {
    const state = showWord(startTurn(createGame(['Ana']), makeTabuWord(dog), 60), makeTabuWord(same))
    expect(state.word?.item.id).toBe('2')
  })

  it('tick counts down and never goes below zero', () => {
    let state = startTurn(createGame(['Ana']), makeTabuWord(dog), 1)
    state = tick(state)
    expect(state.secondsLeft).toBe(0)
    state = tick(state)
    expect(state.secondsLeft).toBe(0)
  })
})

describe('player rotation', () => {
  it('isLastTurn is only true for the final describer', () => {
    const state = createGame(['Ana', 'Ben', 'Cas'])
    expect(isLastTurn(state)).toBe(false)
    expect(isLastTurn(nextPlayer(nextPlayer(state)))).toBe(true)
  })

  it('nextPlayer wraps around and clears the round', () => {
    let state = startTurn(createGame(['Ana', 'Ben']), makeTabuWord(dog), 60)
    state = nextPlayer(state)
    expect(state.describerIndex).toBe(1)
    state = nextPlayer(state)
    expect(state.describerIndex).toBe(0)
    expect(state.word).toBeNull()
    expect(state.secondsLeft).toBe(0)
  })
})

describe('winner', () => {
  it('picks the highest score, first player breaking ties', () => {
    let state = createGame(['Ana', 'Ben', 'Cas'])
    state = { ...state, scores: [2, 3, 3] }
    expect(winner(state)).toEqual({ name: 'Ben', score: 3 })
  })
})
