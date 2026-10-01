/** Colours for players in room games, by seat. */
export const SEAT_COLORS = ['var(--player-red)', 'var(--player-blue)', 'var(--player-green)', 'var(--player-yellow)', 'var(--player-purple)', 'var(--player-pink)']

export const seatColor = (seat: number) => SEAT_COLORS[seat % SEAT_COLORS.length]
