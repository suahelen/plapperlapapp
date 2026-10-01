/**
 * Kaboom, the classroom stick game, as a pure state machine.
 *
 * Teams take turns drawing a stick from the cup:
 *  - word stick: answer correctly and keep it; otherwise it goes back into the cup.
 *  - KABOOM stick: all of the team's sticks go back into the cup (the KABOOM stick too).
 *
 * The game ends when no word sticks are left in the cup (or when time runs out);
 * the team with the most sticks wins.
 */
import type { VocabularyItem } from '../types'
import { defaultRng, shuffle, type Rng } from '../shared/random'
import type { KaboomSettings, KaboomState, Stick, Team } from './types'

export const TEAM_COLORS = ['var(--player-red)', 'var(--player-blue)', 'var(--player-green)', 'var(--player-yellow)', 'var(--player-purple)', 'var(--player-pink)']
/** Team colours in order; the component names teams via games.kaboom.teams.<key>. */
export const TEAM_KEYS = ['red', 'blue', 'green', 'yellow', 'purple', 'pink'] as const

const KABOOM_SHARE: Record<KaboomSettings['kaboomShare'], number> = { low: 0.1, medium: 0.18, high: 0.28 }

/** Number of KABOOM sticks for a cup with `sticks` word sticks (at least one). */
export function kaboomCount(sticks: number, share: KaboomSettings['kaboomShare']): number {
  return Math.max(1, Math.round(sticks * KABOOM_SHARE[share]))
}

export function createGame(
  teams: { name: string; color: string }[],
  items: VocabularyItem[],
  settings: Pick<KaboomSettings, 'sticks' | 'kaboomShare'>,
  rng: Rng = defaultRng,
): KaboomState {
  if (teams.length < 1) throw new Error('at least one team required')
  if (items.length < 1) throw new Error('at least one word required')

  // Word sticks cycle through the (shuffled) vocabulary if there are more sticks than words.
  const words = shuffle(items, rng)
  let id = 0
  const cup: Stick[] = []
  for (let i = 0; i < settings.sticks; i++) cup.push({ id: id++, kind: 'word', itemId: words[i % words.length].id })
  for (let i = 0; i < kaboomCount(settings.sticks, settings.kaboomShare); i++) cup.push({ id: id++, kind: 'kaboom' })

  return {
    cup: shuffle(cup, rng),
    teams: teams.map((t): Team => ({ ...t, sticks: [], correct: 0, answered: 0, kabooms: 0 })),
    current: 0,
    phase: 'draw',
    drawn: null,
    lost: 0,
  }
}

export const wordSticksInCup = (s: KaboomState) => s.cup.filter((x) => x.kind === 'word').length

/** Puts sticks back into the cup at random positions. */
function returnToCup(cup: Stick[], sticks: Stick[], rng: Rng): Stick[] {
  return shuffle([...cup, ...sticks], rng)
}

export function draw(state: KaboomState, rng: Rng = defaultRng): KaboomState {
  if (state.phase !== 'draw' || state.cup.length === 0) return state
  const [drawn, ...cup] = state.cup

  if (drawn.kind === 'word') return { ...state, cup, drawn, phase: 'answer', lost: 0 }

  const team = state.teams[state.current]
  const teams = state.teams.map((t, i) => (i === state.current ? { ...t, sticks: [], kabooms: t.kabooms + 1 } : t))
  return {
    ...state,
    teams,
    cup: returnToCup(cup, [drawn, ...team.sticks], rng),
    drawn,
    phase: 'kaboom',
    lost: team.sticks.length,
  }
}

export function answer(state: KaboomState, correct: boolean, rng: Rng = defaultRng): KaboomState {
  if (state.phase !== 'answer' || !state.drawn) return state
  const drawn = state.drawn
  const teams = state.teams.map((t, i) =>
    i === state.current
      ? {
          ...t,
          answered: t.answered + 1,
          correct: t.correct + (correct ? 1 : 0),
          sticks: correct ? [...t.sticks, drawn] : t.sticks,
        }
      : t,
  )
  const cup = correct ? state.cup : returnToCup(state.cup, [drawn], rng)
  return nextTurn({ ...state, teams, cup })
}

/** Continues after the KABOOM has been shown. */
export function acknowledgeKaboom(state: KaboomState): KaboomState {
  if (state.phase !== 'kaboom') return state
  return nextTurn(state)
}

function nextTurn(state: KaboomState): KaboomState {
  const next = { ...state, drawn: null, current: (state.current + 1) % state.teams.length }
  if (wordSticksInCup(next) === 0) return { ...next, phase: 'finished' }
  return { ...next, phase: 'draw' }
}

/** Ends the game early (time limit). */
export function finish(state: KaboomState): KaboomState {
  return { ...state, phase: 'finished', drawn: null }
}

/** Teams sorted by collected sticks, with shared ranks for ties. */
export function ranking(state: KaboomState): { team: Team; rank: number }[] {
  const sorted = [...state.teams].sort((a, b) => b.sticks.length - a.sticks.length)
  return sorted.map((team) => ({
    team,
    rank: 1 + sorted.filter((t) => t.sticks.length > team.sticks.length).length,
  }))
}
