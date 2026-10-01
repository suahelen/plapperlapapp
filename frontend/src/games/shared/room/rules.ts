/**
 * Room helpers shared by the TypeScript room engines, which simulate the Go server in
 * test mode. They mirror backend/internal/rooms/players.go.
 */

/** A rule violation, reported like the server's ActionError. */
export class RuleError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

const MAX_NAME_LENGTH = 20

/** Trims and shortens a player name; empty stays empty (shown via playerName() in the game language). */
export function cleanName(name: string): string {
  return Array.from(name.trim().replace(/\s+/g, ' ')).slice(0, MAX_NAME_LENGTH).join('')
}

export interface Roster {
  names: string[]
  started: boolean
}

export const newRoster = (): Roster => ({ names: [], started: false })

export function rosterJoin(r: Roster, seat: number, name: string) {
  if (r.started) throw new RuleError('GAME_STARTED', 'This game has already started.')
  r.names[seat] = cleanName(name)
}

export function rosterStart(r: Roster, seat: number, min: number) {
  if (r.started) throw new RuleError('ALREADY_STARTED', 'The game has already started.')
  if (seat !== 0) throw new RuleError('NOT_HOST', 'Only the player who created the room can start the game.')
  if (r.names.length < min) throw new RuleError('NOT_ENOUGH_PLAYERS', 'Wait for more players to join.')
  r.started = true
}

export function checkSkip(actor: number, current: number) {
  if (actor !== 0) throw new RuleError('NOT_HOST', 'Only the player who created the room can skip a turn.')
  if (current === 0) throw new RuleError('INVALID_ACTION', "You can't skip your own turn.")
}
