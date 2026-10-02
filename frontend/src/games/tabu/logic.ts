/**
 * Tabu: one device is passed around. Each player, in turn, describes words to the
 * rest of the group without saying the word itself or its translation, for a fixed
 * time. Whoever is holding the device marks each guess as correct or skips it -
 * the app never judges speech, the describer does, same as the physical game.
 * Pure state functions; the timer and word drawing live in the component.
 */
import type { VocabularyItem } from '../types'
import type { TabuState, TabuWord } from './types'

export function createGame(players: string[]): TabuState {
  return {
    players,
    scores: players.map(() => 0),
    describerIndex: 0,
    word: null,
    secondsLeft: 0,
    correctThisTurn: 0,
    skippedThisTurn: 0,
  }
}

/** The word to guess plus its taboo words (itself and its translation, deduplicated). */
export function makeTabuWord(item: VocabularyItem): TabuWord {
  const taboo = [item.target, item.source].filter((w, i, all) => all.indexOf(w) === i)
  return { item, taboo }
}

export function startTurn(state: TabuState, word: TabuWord, roundSeconds: number): TabuState {
  return { ...state, word, secondsLeft: roundSeconds, correctThisTurn: 0, skippedThisTurn: 0 }
}

export function showWord(state: TabuState, word: TabuWord): TabuState {
  return { ...state, word }
}

export function markCorrect(state: TabuState): TabuState {
  const scores = state.scores.slice()
  scores[state.describerIndex]++
  return { ...state, scores, correctThisTurn: state.correctThisTurn + 1, word: null }
}

export function markSkip(state: TabuState): TabuState {
  return { ...state, skippedThisTurn: state.skippedThisTurn + 1, word: null }
}

export function tick(state: TabuState): TabuState {
  return { ...state, secondsLeft: Math.max(0, state.secondsLeft - 1) }
}

export function isLastTurn(state: TabuState): boolean {
  return state.describerIndex === state.players.length - 1
}

export function nextPlayer(state: TabuState): TabuState {
  return { ...state, describerIndex: (state.describerIndex + 1) % state.players.length, word: null, secondsLeft: 0 }
}

/** The player with the most correct words; the first in case of a tie. */
export function winner(state: TabuState): { name: string; score: number } {
  let best = 0
  for (let i = 1; i < state.scores.length; i++) {
    if (state.scores[i] > state.scores[best]) best = i
  }
  return { name: state.players[best], score: state.scores[best] }
}
