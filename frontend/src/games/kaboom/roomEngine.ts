/**
 * Multi-device Kaboom for test mode only (src/api/mockRooms.ts). Mirrors
 * backend/internal/rooms/kaboom and reuses the single-device rules in ./logic.ts.
 */
import type { VocabularyItem } from '../types'
import { shuffle, type Rng } from '../shared/random'
import { isCorrect } from '../shared/answer/check'
import { makePrompt, type Prompt } from '../shared/answer/prompt'
import { RuleError, checkSkip, newRoster, rosterJoin, rosterStart, type Roster } from '../shared/room/rules'
import { toRoomPrompt } from '../shared/room/roomPrompt'
import { acknowledgeKaboom, answer, createGame, draw, finish, ranking, wordSticksInCup } from './logic'
import type { KaboomSettings, KaboomState } from './types'
import type { KaboomRoomView } from './roomTypes'

const MIN_PLAYERS = 2

export interface KaboomRoomState {
  roster: Roster
  items: VocabularyItem[]
  settings: Pick<KaboomSettings, 'direction' | 'sticks' | 'kaboomShare' | 'timeLimit'>
  game: KaboomState | null
  prompt: Prompt | null
  endsAt: number
  starter: number
  last: KaboomRoomView['lastEvent']
  seq: number
}

function setup(s: KaboomRoomState, rng: Rng) {
  const g = createGame(
    s.roster.names.map((name) => ({ name, color: '' })),
    s.items,
    s.settings,
    rng,
  )
  s.game = { ...g, current: s.starter }
  s.prompt = null
  s.last = null
  s.endsAt = s.settings.timeLimit > 0 ? Date.now() + s.settings.timeLimit * 60_000 : 0
}

function event(s: KaboomRoomState, seat: number, kind: NonNullable<KaboomRoomView['lastEvent']>['kind']) {
  s.last = { seq: ++s.seq, seat, kind }
  return s.last
}

function requireTurn(s: KaboomRoomState, seat: number, phase: KaboomState['phase']): KaboomState {
  const g = s.game
  if (!g || g.phase !== phase) throw new RuleError('WRONG_PHASE', "That's not possible right now.")
  if (seat !== g.current) throw new RuleError('NOT_YOUR_TURN', "It's not your turn.")
  return g
}

/** After each turn: finish once the time limit has passed. */
function checkTime(s: KaboomRoomState) {
  if (s.game && s.endsAt && Date.now() >= s.endsAt && s.game.phase !== 'finished') s.game = finish(s.game)
}

export const kaboomRoomEngine = {
  maxPlayers: 6,

  create(content: { items: VocabularyItem[]; settings: Record<string, unknown> }): KaboomRoomState {
    if (content.items.length === 0) throw new RuleError('NO_VOCABULARY', 'This activity has no vocabulary.')
    const st = content.settings
    const sticks = Number(st.sticks)
    const minutes = Number(st.timeLimit)
    return {
      roster: newRoster(),
      items: content.items,
      settings: {
        direction: (st.direction as KaboomSettings['direction']) ?? 'source-to-target',
        sticks: Number.isInteger(sticks) && sticks >= 5 && sticks <= 80 ? sticks : 30,
        kaboomShare: ['low', 'medium', 'high'].includes(String(st.kaboomShare)) ? (st.kaboomShare as KaboomSettings['kaboomShare']) : 'medium',
        timeLimit: Number.isInteger(minutes) && minutes > 0 && minutes <= 60 ? minutes : 0,
      },
      game: null,
      prompt: null,
      endsAt: 0,
      starter: 0,
      last: null,
      seq: 0,
    }
  },

  join(s: KaboomRoomState, seat: number, name: string) {
    rosterJoin(s.roster, seat, name)
  },

  apply(s: KaboomRoomState, seat: number, action: Record<string, unknown>, rng: Rng) {
    switch (action.type) {
      case 'start':
        rosterStart(s.roster, seat, MIN_PLAYERS)
        return setup(s, rng)

      case 'draw': {
        const g = draw(requireTurn(s, seat, 'draw'), rng)
        s.game = g
        if (g.drawn?.kind === 'word') {
          const item = s.items.find((i) => i.id === (g.drawn as { itemId: string }).itemId)!
          s.prompt = makePrompt(item, s.settings.direction, rng)
          event(s, seat, 'word')
        } else {
          event(s, seat, 'kaboom').lost = g.lost
        }
        return
      }

      case 'answer': {
        const g = requireTurn(s, seat, 'answer')
        const given = String(action.answer ?? '')
        const expected = s.prompt?.expected ?? ''
        const correct = isCorrect(given, expected)
        s.game = answer(g, correct, rng)
        const ev = event(s, seat, correct ? 'correct' : 'wrong')
        if (!correct) Object.assign(ev, { given, expected })
        s.prompt = null
        return checkTime(s)
      }

      case 'continue': {
        const g = s.game
        if (!g || g.phase !== 'kaboom') throw new RuleError('WRONG_PHASE', 'Nothing to continue.')
        if (seat !== g.current && seat !== 0) throw new RuleError('NOT_YOUR_TURN', "It's not your turn.")
        s.game = acknowledgeKaboom(g)
        return checkTime(s)
      }

      case 'skip': {
        const g = s.game
        if (!g || !['draw', 'answer', 'kaboom'].includes(g.phase)) throw new RuleError('WRONG_PHASE', 'The game is not running.')
        checkSkip(seat, g.current)
        event(s, g.current, 'skip')
        if (g.phase === 'kaboom') s.game = acknowledgeKaboom(g)
        else {
          const cup = g.phase === 'answer' && g.drawn ? shuffle([...g.cup, g.drawn], rng) : g.cup
          const next = { ...g, cup, drawn: null, current: (g.current + 1) % g.teams.length }
          s.game = { ...next, phase: wordSticksInCup(next) === 0 ? 'finished' : 'draw' }
        }
        s.prompt = null
        return checkTime(s)
      }

      case 'timeUp':
        if (!s.endsAt || Date.now() < s.endsAt) throw new RuleError('NOT_YET', 'Time is not up yet.')
        if (s.game && s.game.phase !== 'finished') {
          event(s, s.game.current, 'timeup')
          s.game = finish(s.game)
          s.prompt = null
        }
        return

      case 'rematch':
        if (s.game?.phase !== 'finished') throw new RuleError('WRONG_PHASE', 'The game is not over yet.')
        s.starter = (s.starter + 1) % s.roster.names.length
        return setup(s, rng)
    }
    throw new RuleError('INVALID_ACTION', 'Unknown action.')
  },

  view(s: KaboomRoomState, seat: number): KaboomRoomView {
    const g = s.game
    const players = s.roster.names.map((name, i) => {
      const t = g?.teams[i]
      return { name, sticks: t?.sticks.length ?? 0, correct: t?.correct ?? 0, answered: t?.answered ?? 0, kabooms: t?.kabooms ?? 0 }
    })
    const held = players.reduce((n, p) => n + p.sticks, 0)
    return {
      phase: g ? g.phase : 'lobby',
      you: seat,
      turn: g?.current ?? 0,
      minPlayers: MIN_PLAYERS,
      players,
      cupCount: g?.cup.length ?? 0,
      wordsLeft: g ? wordSticksInCup(g) : 0,
      capacity: (g?.cup.length ?? 0) + held + (g?.phase === 'answer' ? 1 : 0),
      prompt: g?.phase === 'answer' && s.prompt ? toRoomPrompt(s.prompt) : null,
      endsAt: s.endsAt,
      winners: g?.phase === 'finished' ? ranking(g).filter((r) => r.rank === 1).map((r) => g.teams.indexOf(r.team)) : [],
      lastEvent: s.last,
    }
  },
}
