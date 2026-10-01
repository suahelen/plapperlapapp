import { parseDelimited } from './importFile'

/**
 * Parses tabular text copied from Excel, Google Sheets, Word tables etc. Tabs usually
 * separate columns, but semicolon/comma separated text (CSV) is recognised too.
 * Newlines separate rows, empty rows are ignored.
 */
export interface ParsedTable {
  rows: string[][]
  columnCount: number
  /** True when rows don't all have exactly two columns and the teacher should confirm the mapping. */
  ambiguous: boolean
}

export function parsePaste(text: string): ParsedTable {
  const rows = parseDelimited(text)
    .map((cells) => cells.map((c) => c.trim()))
    .filter((cells) => cells.some((c) => c !== ''))

  const columnCount = rows.reduce((max, r) => Math.max(max, r.length), 0)
  const ambiguous = rows.some((r) => r.length !== 2)
  return { rows, columnCount, ambiguous }
}

export interface PastedEntry {
  source: string
  target: string
  /** Extra columns from imported tables end up in metadata.fields. */
  metadata?: Record<string, unknown>
}

/** Maps rows to entries using the chosen columns. Rows missing either value are skipped. */
export function toEntries(rows: string[][], sourceCol = 0, targetCol = 1): { entries: PastedEntry[]; skipped: number } {
  const entries: PastedEntry[] = []
  let skipped = 0
  for (const r of rows) {
    const source = r[sourceCol] ?? ''
    const target = r[targetCol] ?? ''
    if (source && target) entries.push({ source, target })
    else skipped++
  }
  return { entries, skipped }
}
