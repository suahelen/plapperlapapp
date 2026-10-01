/**
 * Reads vocabulary tables from files teachers already have: CSV (any separator and
 * encoding Excel produces), Excel .xlsx, and Quizlet/Anki text exports. Everything runs in
 * the browser; the result goes through the same preview as pasted tables.
 */
import { languageCode } from './languages'

export const MAX_FILE_BYTES = 5 * 1024 * 1024
/** Matches the backend limit for one vocabulary set. */
export const MAX_ROWS = 2000

export interface ImportedSheet {
  name: string
  rows: string[][]
}

export interface ImportedTable {
  sheets: ImportedSheet[]
  /** Some rows were cut off because of MAX_ROWS. */
  truncated: boolean
}

/** A problem the teacher can act on. `key` is a message key (`import.errors.*`). */
export class ImportError extends Error {
  constructor(
    public key: string,
    public params: Record<string, unknown> = {},
  ) {
    super(key)
  }
}

export const ACCEPTED_FILES = '.csv,.tsv,.txt,.xlsx,.xlsm'

export async function readTableFile(file: File): Promise<ImportedTable> {
  if (file.size > MAX_FILE_BYTES) throw new ImportError('import.errors.tooLarge', { mb: MAX_FILE_BYTES / 1024 / 1024 })
  const ext = file.name.toLowerCase().split('.').pop() ?? ''
  if (['xls', 'ods', 'numbers', 'docx', 'doc', 'pdf'].includes(ext)) {
    throw new ImportError(ext === 'pdf' || ext.startsWith('doc') ? 'import.errors.wordPdf' : 'import.errors.unsupported')
  }
  const buffer = await file.arrayBuffer()
  return ext === 'xlsx' || ext === 'xlsm' ? readWorkbook(buffer) : fromText(decodeText(buffer))
}

// --- Excel --------------------------------------------------------------------------

export async function readWorkbook(buffer: ArrayBuffer): Promise<ImportedTable> {
  // Loaded on demand: the Excel reader is only downloaded when someone imports a workbook.
  const { default: readXlsxFile } = await import('read-excel-file/universal')
  let sheets: { sheet: string; data: unknown[][] }[]
  try {
    sheets = await readXlsxFile(buffer)
  } catch {
    throw new ImportError('import.errors.excel')
  }
  let truncated = false
  const out = sheets
    .map((s) => {
      const t = cleanRows(s.data.map((row) => row.map(cellText)))
      truncated ||= t.truncated
      return { name: s.sheet, rows: t.rows }
    })
    .filter((s) => s.rows.length > 0)
  if (out.length === 0) throw new ImportError('import.errors.empty')
  return { sheets: out, truncated }
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v)
}

// --- text files ---------------------------------------------------------------------

/**
 * Decodes a text file. Excel writes CSV as windows-1252 on Windows and "Unicode text" as
 * UTF-16; everything else is UTF-8 (with or without BOM).
 */
export function decodeText(buffer: ArrayBuffer): string {
  const b = new Uint8Array(buffer)
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2))
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2))
  const start = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(start))
  } catch {
    return new TextDecoder('windows-1252').decode(b)
  }
}

export function fromText(text: string): ImportedTable {
  const t = cleanRows(parseDelimited(text))
  if (t.rows.length === 0) throw new ImportError('import.errors.empty')
  return { sheets: [{ name: '', rows: t.rows }], truncated: t.truncated }
}

const DELIMITERS = ['\t', ';', ',', '|']
const ANKI_SEPARATORS: Record<string, string> = { tab: '\t', semicolon: ';', comma: ',', pipe: '|', space: ' ' }

/**
 * Parses delimited text (CSV/TSV, RFC 4180 quoting). The separator is detected unless
 * given. Anki export headers ("#separator:tab") are honoured and removed, and HTML
 * formatting from Anki/Quizlet is reduced to plain text.
 */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  let body = text.replace(/^﻿/, '')
  let html = false
  // Anki: "#separator:tab", "#html:true", "#columns:…" lines at the top.
  const header = /^#([a-z ]+):(.*)\r?\n/i
  for (let m = header.exec(body); m; m = header.exec(body)) {
    const [key, value] = [m[1].trim().toLowerCase(), m[2].trim().toLowerCase()]
    if (key === 'separator' && ANKI_SEPARATORS[value]) delimiter ??= ANKI_SEPARATORS[value]
    if (key === 'html') html = value === 'true'
    body = body.slice(m[0].length)
  }
  html ||= /<\/?(b|i|u|br|div|span|p|font|strong|em)\b[^>]*>/i.test(body) || /&(nbsp|amp|lt|gt|quot);/.test(body)
  // An entity's ";" ("&nbsp;") must not split cells of a semicolon-separated export.
  if (html) body = body.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, '&$1\u0001')
  const d = delimiter ?? detectDelimiter(body)
  const rows = parseRecords(body, d)
  return html ? rows.map((r) => r.map((c) => stripHtml(c.replace(/\u0001/g, ';')))) : rows
}

/** Picks the separator that gives the most consistent column count (≥ 2) over the first rows. */
export function detectDelimiter(text: string): string {
  const sample = text.slice(0, 20_000)
  let best = '\t'
  let bestScore = 0
  for (const d of DELIMITERS) {
    const counts = parseRecords(sample, d)
      .slice(0, 20)
      .filter((r) => r.some((c) => c.trim() !== ''))
      .map((r) => r.length)
    if (counts.length === 0) continue
    const freq = new Map<number, number>()
    for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1)
    const [mode, n] = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]
    if (mode < 2) continue
    const score = n / counts.length
    if (score > bestScore) [best, bestScore] = [d, score]
  }
  return best
}

/** RFC 4180 records: quoted fields may contain separators, quotes ("") and line breaks. */
export function parseRecords(text: string, d: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let atCellStart = true
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
      continue
    }
    if (ch === '"' && atCellStart) {
      quoted = true
      atCellStart = false
    } else if (ch === d) {
      row.push(cell)
      cell = ''
      atCellStart = true
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      atCellStart = true
    } else {
      // Leading spaces before an opening quote (e.g. `a, "b"`) are common in hand-made CSV.
      if (!(atCellStart && ch === ' ' && text[i + 1] === '"')) atCellStart = false
      cell += ch
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function stripHtml(s: string): string {
  return s
    .replace(/\[sound:[^\]]*\]/g, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') return String.fromCodePoint(parseInt(e[1] === 'x' ? e.slice(2) : e.slice(1), e[1] === 'x' ? 16 : 10))
      return ENTITIES[e.toLowerCase()] ?? m
    })
}

/** Trims cells, collapses inner whitespace, drops empty rows and caps the row count. */
function cleanRows(rows: string[][]): { rows: string[][]; truncated: boolean } {
  const out = rows
    .map((r) => r.map((c) => c.replace(/\s+/g, ' ').trim()))
    .filter((r) => r.some((c) => c !== ''))
  // One extra row: the first may be a header.
  return { rows: out.slice(0, MAX_ROWS + 1), truncated: out.length > MAX_ROWS + 1 }
}

// --- header and column detection ----------------------------------------------------

const HEADER_WORDS = new Set([
  'wort', 'wörter', 'übersetzung', 'begriff', 'bedeutung', 'vokabel', 'vokabeln', 'ausdruck', 'lösung',
  'antwort', 'frage', 'term', 'terms', 'definition', 'word', 'translation', 'meaning', 'answer', 'question',
  'front', 'back', 'vorderseite', 'rückseite', 'source', 'target', 'mot', 'traduction', 'parola', 'traduzione',
  'palabra', 'traducción',
])

export interface ColumnGuess {
  /** The first row is a header, not an entry. */
  header: boolean
  sourceCol: number
  targetCol: number
  /** Language names from the header for the chosen columns, if recognisable. */
  sourceLanguage?: string
  targetLanguage?: string
  /** Columns with known textbook headers (Unit, Seite, Wortart, …), kept as extra columns. */
  extraCols: number[]
}

/** Headers of columns worth keeping with each word, e.g. to choose words by unit later. */
const EXTRA_WORDS = new Set([
  'unit', 'units', 'lektion', 'lektionen', 'kapitel', 'chapter', 'lesson', 'seite', 'page', 'wortart', 'wortklasse',
  'part of speech', 'thema', 'topic', 'kategorie', 'category', 'niveau', 'level', 'stufe', 'gruppe', 'group', 'tag',
  'tags', 'band', 'unité', 'unite', 'leçon', 'lecon', 'chapitre', 'unità', 'lezione', 'capitolo', 'pagina', 'unidad',
  'lección', 'leccion', 'capítulo', 'página', 'modul', 'module', 'dossier', 'semaine', 'woche', 'week',
])
const norm = (c: string) => c.trim().toLowerCase().replace(/[:.]$/, '')
export const isExtraHeader = (c: string) => EXTRA_WORDS.has(norm(c))

const isHeaderCell = (c: string) => !!languageCode(c) || HEADER_WORDS.has(norm(c)) || isExtraHeader(c)

/**
 * Guesses whether row 1 is a header and which columns hold the two languages. Columns
 * whose header names the set's languages win; otherwise the first two language columns,
 * otherwise the first two non-empty columns.
 */
export function detectColumns(rows: string[][], setLanguages: { source?: string; target?: string } = {}): ColumnGuess {
  const first = rows[0] ?? []
  const header = rows.length > 1 && first.filter((c) => c && isHeaderCell(c)).length >= 2
  const data = header ? rows.slice(1) : rows
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0)
  const filled = Array.from({ length: width }, (_, c) => c).filter((c) => data.some((r) => (r[c] ?? '') !== ''))
  const pick = (a?: number, b?: number): [number, number] => {
    const s = a ?? filled[0] ?? 0
    const t = b ?? filled.find((c) => c !== s) ?? Math.min(1, width - 1)
    return [s, t]
  }

  if (!header) {
    const [sourceCol, targetCol] = pick()
    return { header, sourceCol, targetCol, extraCols: [] }
  }

  const codes = first.map((c) => languageCode(c))
  const find = (lang?: string) => {
    const code = languageCode(lang)
    const i = code ? codes.indexOf(code) : -1
    return i >= 0 ? i : undefined
  }
  let s = find(setLanguages.source)
  let t = find(setLanguages.target)
  if (s === undefined || t === undefined || s === t) {
    const langCols = codes.flatMap((c, i) => (c ? [i] : []))
    ;[s, t] = langCols.length >= 2 ? [langCols[0], langCols[1]] : [undefined, undefined]
  }
  const [sourceCol, targetCol] = pick(s, t)
  return {
    header,
    sourceCol,
    targetCol,
    sourceLanguage: codes[sourceCol] ? first[sourceCol] : undefined,
    targetLanguage: codes[targetCol] ? first[targetCol] : undefined,
    extraCols: first.flatMap((c, i) => (i !== sourceCol && i !== targetCol && c && isExtraHeader(c) ? [i] : [])),
  }
}

/** "Unit 4 Vocabulary.xlsx" → "Unit 4 Vocabulary". */
export function titleFromFileName(name: string): string {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[_]+/g, ' ')
    .trim()
    .slice(0, 200)
}
