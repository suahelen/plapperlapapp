/**
 * Conjugation tables ("grid" vocabulary): rows (e.g. pronouns) × columns (e.g. verbs).
 * Each filled cell is stored as a normal vocabulary item so every game can use it:
 *   source "nous (aller)", target "allons", metadata.grid = { row: "nous", col: "aller" }
 * Multiplayer Schiffe versenken uses the grid metadata to lay out its board.
 */
import { parseDelimited } from './importFile'

export interface GridCellRef {
  row: string
  col: string
}

export interface GridTable {
  rows: string[]
  cols: string[]
  /** cells[r][c] is the answer text ('' for an empty cell). */
  cells: string[][]
}

interface ItemLike {
  source: string
  target: string
  metadata?: Record<string, unknown>
}

export function gridOf(item: { metadata?: Record<string, unknown> }): GridCellRef | null {
  const g = item.metadata?.grid as { row?: unknown; col?: unknown } | undefined
  if (!g || typeof g.row !== 'string' || typeof g.col !== 'string' || !g.row || !g.col) return null
  return { row: g.row, col: g.col }
}

export const gridSource = (row: string, col: string) => `${row} (${col})`

/** True when the set is a conjugation table (every item has grid metadata). */
export function isGridSet(items: ItemLike[]): boolean {
  return items.length > 0 && items.every((i) => gridOf(i) !== null)
}

/** Rebuilds the table from items (first appearance defines row/column order). */
export function itemsToTable(items: ItemLike[]): GridTable {
  const rows: string[] = []
  const cols: string[] = []
  for (const it of items) {
    const g = gridOf(it)
    if (!g) continue
    if (!rows.includes(g.row)) rows.push(g.row)
    if (!cols.includes(g.col)) cols.push(g.col)
  }
  const cells = rows.map(() => cols.map(() => ''))
  for (const it of items) {
    const g = gridOf(it)
    if (g) cells[rows.indexOf(g.row)][cols.indexOf(g.col)] = it.target
  }
  return { rows, cols, cells }
}

/** Converts the table to items, column by column. Empty cells and unlabeled rows/columns are skipped. */
export function tableToItems(t: GridTable): { source: string; target: string; metadata: Record<string, unknown> }[] {
  const items = []
  for (let c = 0; c < t.cols.length; c++) {
    const col = t.cols[c].trim()
    if (!col) continue
    for (let r = 0; r < t.rows.length; r++) {
      const row = t.rows[r].trim()
      const target = (t.cells[r]?.[c] ?? '').trim()
      if (!row || !target) continue
      items.push({ source: gridSource(row, col), target, metadata: { grid: { row, col } } })
    }
  }
  return items
}

/**
 * Parses a table pasted from a spreadsheet: the first row holds the column headers
 * (its first cell is ignored), the first column holds the row headers.
 */
export function parseGridPaste(text: string): GridTable | null {
  return gridFromRows(parseDelimited(text))
}

/** Builds a table from rows (pasted or imported from a file), laid out as in parseGridPaste. */
export function gridFromRows(input: string[][]): GridTable | null {
  const lines = input.map((l) => l.map((c) => c.trim())).filter((cells) => cells.some((c) => c !== ''))
  if (lines.length < 2 || lines[0].length < 2) return null
  const cols = lines[0].slice(1)
  const rows = lines.slice(1).map((l) => l[0] ?? '')
  const cells = lines.slice(1).map((l) => cols.map((_, c) => l[c + 1] ?? ''))
  return { rows, cols, cells }
}
