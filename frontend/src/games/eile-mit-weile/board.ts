/**
 * Board geometry in a 100×100 SVG coordinate space.
 *
 * The shared track runs clockwise around a square. Each seat's start field is at the
 * middle of one side (bottom, left, top, right); its home stretch leads from there to
 * the centre goal, and its stall sits in the quadrant just before its start field.
 */
import type { BoardConfig, PlayerColor } from './types'
import { seatOf, trackField } from './logic'

export interface Point {
  x: number
  y: number
}

const MIN = 10
const MAX = 90
const SIDE = MAX - MIN
const PERIMETER = SIDE * 4
const CENTER: Point = { x: 50, y: 50 }

/** Position of absolute track field `i` (0 = bottom middle, clockwise). */
export function trackPoint(i: number, c: BoardConfig): Point {
  let d = (i / c.trackLength) * PERIMETER
  // bottom half from middle to the left corner
  if (d <= SIDE / 2) return { x: 50 - d, y: MAX }
  d -= SIDE / 2
  if (d <= SIDE) return { x: MIN, y: MAX - d } // left side, upwards
  d -= SIDE
  if (d <= SIDE) return { x: MIN + d, y: MIN } // top, rightwards
  d -= SIDE
  if (d <= SIDE) return { x: MAX, y: MIN + d } // right side, downwards
  d -= SIDE
  return { x: MAX - d, y: MAX } // bottom, back to the middle
}

const SIDE_MID: Point[] = [
  { x: 50, y: MAX },
  { x: MIN, y: 50 },
  { x: 50, y: MIN },
  { x: MAX, y: 50 },
]

/** Position of home-stretch field `k` (0 = first, last = goal) for a colour. */
export function homePoint(color: PlayerColor, k: number, c: BoardConfig): Point {
  const mid = SIDE_MID[seatOf(color)]
  const dx = (CENTER.x - mid.x) / 40
  const dy = (CENTER.y - mid.y) / 40
  // Spread fields between 8 units from the edge and 11 units from the centre.
  const span = 40 - 8 - 11
  const dist = 8 + (c.homeLength > 1 ? (k * span) / (c.homeLength - 1) : span)
  return { x: mid.x + dx * dist, y: mid.y + dy * dist }
}

// Quadrant centres of the stall for each seat (the quadrant before the start field).
const STALL_CENTER: Point[] = [
  { x: 71, y: 71 },
  { x: 29, y: 71 },
  { x: 29, y: 29 },
  { x: 71, y: 29 },
]

export function stallCenter(color: PlayerColor): Point {
  return STALL_CENTER[seatOf(color)]
}

export function stallPoint(color: PlayerColor, pawn: number): Point {
  const c = stallCenter(color)
  const offsets = [
    [-5, -5],
    [5, -5],
    [-5, 5],
    [5, 5],
  ]
  const [ox, oy] = offsets[pawn % 4]
  return { x: c.x + ox, y: c.y + oy }
}

/** Where a pawn with the given progress is drawn. */
export function pawnPoint(color: PlayerColor, pawn: number, progress: number, c: BoardConfig): Point {
  if (progress < 0) return stallPoint(color, pawn)
  if (progress >= c.trackLength) return homePoint(color, progress - c.trackLength, c)
  const field = trackField(color, progress, c)!
  return trackPoint(field, c)
}

/** Radius for track fields, based on spacing. */
export function fieldRadius(c: BoardConfig): number {
  return Math.min(3.4, (PERIMETER / c.trackLength) * 0.38)
}
