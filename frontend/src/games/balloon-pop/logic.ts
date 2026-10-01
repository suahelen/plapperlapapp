/**
 * Ballon-Platzen: a word is shown, balloons carrying possible translations float up.
 * Tap the right one before it escapes. Wrong taps and escaped answers cost a life.
 * Pure state functions; timing and animation live in the component.
 */
import type { VocabularyItem } from '../types'
import { buildChoices, makePrompt } from '../shared/answer/prompt'
import { defaultRng, shuffle, type Rng } from '../shared/random'
import type { BalloonPopSettings, BalloonState, Round } from './types'

export const BALLOON_COLORS = ['var(--deco-1)', 'var(--deco-2)', 'var(--deco-3)', 'var(--deco-4)', 'var(--deco-5)', 'var(--deco-6)']

const BASE_DURATION: Record<BalloonPopSettings['speed'], number> = { slow: 10, normal: 7.5, fast: 5.5 }
const SPEEDUP = 0.96
const MIN_SPEED_FACTOR = 0.6

export function createGame(settings: BalloonPopSettings): BalloonState {
  return {
    lives: settings.lives,
    score: 0,
    streak: 0,
    bestStreak: 0,
    roundIndex: 0,
    totalRounds: settings.rounds,
    speedFactor: 1,
    round: null,
    phase: 'playing',
    outcome: null,
    mistakes: 0,
  }
}

export function makeRound(
  item: VocabularyItem,
  pool: VocabularyItem[],
  settings: BalloonPopSettings,
  speedFactor: number,
  rng: Rng = defaultRng,
): Round {
  const prompt = makePrompt(item, settings.direction, rng)
  const texts = buildChoices(prompt, pool, settings.balloonCount, rng)
  const n = texts.length
  const lanes = shuffle(
    Array.from({ length: n }, (_, i) => i),
    rng,
  )
  const colors = shuffle(BALLOON_COLORS, rng)
  return {
    prompt,
    duration: BASE_DURATION[settings.speed] * speedFactor,
    balloons: texts.map((text, i) => ({
      id: i,
      text,
      correct: text === prompt.expected,
      x: n === 1 ? 50 : 12 + (lanes[i] * 76) / (n - 1),
      delay: rng() * 1.4,
      color: colors[i % colors.length],
      popped: null,
    })),
  }
}

export function startRound(state: BalloonState, round: Round): BalloonState {
  return { ...state, round, phase: 'playing', outcome: null, roundIndex: state.roundIndex + 1 }
}

export function tap(state: BalloonState, balloonId: number): BalloonState {
  const round = state.round
  if (state.phase !== 'playing' || !round) return state
  const balloon = round.balloons.find((b) => b.id === balloonId)
  if (!balloon || balloon.popped) return state

  const balloons = round.balloons.map((b) => (b.id === balloonId ? { ...b, popped: balloon.correct ? 'hit' : 'miss' } as const : b))
  const next = { ...state, round: { ...round, balloons } }

  if (balloon.correct) {
    const streak = state.streak + 1
    return {
      ...next,
      score: state.score + 1,
      streak,
      bestStreak: Math.max(state.bestStreak, streak),
      speedFactor: Math.max(MIN_SPEED_FACTOR, state.speedFactor * SPEEDUP),
      phase: 'round-over',
      outcome: 'hit',
    }
  }
  return loseLife({ ...next, streak: 0 }, false)
}

/** The correct balloon floated away without being tapped. */
export function escape(state: BalloonState): BalloonState {
  if (state.phase !== 'playing') return state
  return loseLife({ ...state, streak: 0 }, true)
}

function loseLife(state: BalloonState, endsRound: boolean): BalloonState {
  const lives = state.lives - 1
  const mistakes = state.mistakes + 1
  if (lives <= 0) return { ...state, lives: 0, mistakes, phase: 'finished', outcome: endsRound ? 'escaped' : state.outcome }
  if (endsRound) return { ...state, lives, mistakes, phase: 'round-over', outcome: 'escaped' }
  return { ...state, lives, mistakes }
}

/** Whether another round should follow the one that just ended. */
export function hasNextRound(state: BalloonState): boolean {
  return state.phase === 'round-over' && state.roundIndex < state.totalRounds
}

export function finish(state: BalloonState): BalloonState {
  return { ...state, phase: 'finished' }
}
