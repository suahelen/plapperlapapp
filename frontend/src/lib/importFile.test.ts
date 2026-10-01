import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  decodeText,
  detectColumns,
  detectDelimiter,
  fromText,
  ImportError,
  MAX_ROWS,
  parseDelimited,
  parseRecords,
  readTableFile,
  stripHtml,
  titleFromFileName,
} from './importFile'
import { gridFromRows } from './grid'

const bytes = (...b: number[]) => new Uint8Array(b).buffer

describe('CSV parsing', () => {
  it('handles quotes, escaped quotes, separators and line breaks inside quotes, CRLF', () => {
    expect(parseRecords('a,"b, c"\r\n"say ""hi""","two\nlines"\r\n', ',')).toEqual([
      ['a', 'b, c'],
      ['say "hi"', 'two\nlines'],
    ])
  })

  it('detects the separator', () => {
    expect(detectDelimiter('Haus;house\nHund;dog\n')).toBe(';') // German Excel
    expect(detectDelimiter('Haus,house\nHund,dog\n')).toBe(',')
    expect(detectDelimiter('big, large\tgross\ndog\tHund\n')).toBe('\t')
    expect(detectDelimiter('a|b\nc|d')).toBe('|')
    expect(detectDelimiter('one\ncolumn only')).toBe('\t') // no false split
  })

  it('reads Anki exports: header lines, separator, HTML', () => {
    const anki = '#separator:semicolon\n#html:true\n#columns:Front;Back\n<b>the dog</b>;der&nbsp;Hund<br>[sound:x.mp3]\n'
    expect(parseDelimited(anki)).toEqual([['the dog', 'der Hund ']])
  })

  it('reads Quizlet exports (tab between term and definition)', () => {
    expect(fromText('to go\tgehen\nthe house\tdas Haus\n').sheets[0].rows).toEqual([
      ['to go', 'gehen'],
      ['the house', 'das Haus'],
    ])
  })

  it('strips HTML and decodes entities', () => {
    expect(stripHtml('<div>caf&eacute;? &amp; &#233;t&#xE9;</div>')).toBe('caf&eacute;? & été')
  })
})

describe('decoding', () => {
  it('reads UTF-8 with and without BOM', () => {
    expect(decodeText(new TextEncoder().encode('Müll;é').buffer)).toBe('Müll;é')
    expect(decodeText(bytes(0xef, 0xbb, 0xbf, 0x61))).toBe('a')
  })

  it('falls back to windows-1252 (Excel CSV on Windows)', () => {
    // "Müll;été" in windows-1252
    expect(decodeText(bytes(0x4d, 0xfc, 0x6c, 0x6c, 0x3b, 0xe9, 0x74, 0xe9))).toBe('Müll;été')
  })

  it('reads UTF-16 ("Unicode text" from Excel)', () => {
    expect(decodeText(bytes(0xff, 0xfe, 0x61, 0x00, 0x09, 0x00, 0xfc, 0x00))).toBe('a\tü')
  })
})

describe('reading files', () => {
  it('reads a German-Excel CSV file and cleans rows', async () => {
    const file = new File([bytes(0x48, 0x61, 0x75, 0x73, 0x3b, 0x68, 0x6f, 0x75, 0x73, 0x65, 0x0d, 0x0a, 0x0d, 0x0a, 0x4d, 0xfc, 0x6c, 0x6c, 0x3b, 0x20, 0x77, 0x61, 0x73, 0x74, 0x65)], 'Unit 4.csv')
    expect((await readTableFile(file)).sheets[0].rows).toEqual([
      ['Haus', 'house'],
      ['Müll', 'waste'],
    ])
  })

  it('refuses unsupported formats with a helpful message', async () => {
    await expect(readTableFile(new File(['x'], 'old.xls'))).rejects.toMatchObject({ key: 'import.errors.unsupported' })
    await expect(readTableFile(new File(['x'], 'list.pdf'))).rejects.toBeInstanceOf(ImportError)
    await expect(readTableFile(new File([''], 'empty.csv'))).rejects.toMatchObject({ key: 'import.errors.empty' })
  })

  it('caps the number of rows', () => {
    const t = fromText(Array.from({ length: MAX_ROWS + 10 }, (_, i) => `w${i}\tv${i}`).join('\n'))
    expect([t.sheets[0].rows.length, t.truncated]).toEqual([MAX_ROWS + 1, true])
  })
})

describe('Excel workbooks', () => {
  it('reads every non-empty sheet as text (fixture made with openpyxl)', async () => {
    const buf = readFileSync(fileURLToPath(new URL('./__fixtures__/vocab.xlsx', import.meta.url)))
    const file = new File([buf], 'Unit 4.xlsx')
    const t = await readTableFile(file)
    expect(t.sheets.map((s) => s.name)).toEqual(['Unit 4', 'Französisch'])
    expect(t.sheets[0].rows).toEqual([
      ['Englisch', 'Deutsch', 'Seite'],
      ['the house', 'das Haus', '12'],
      ['to go', 'gehen', '12'],
      ['café', 'Café', '2026-09-30'],
    ])
    expect(gridFromRows(t.sheets[1].rows)?.cells).toEqual([
      ['suis', 'vais'],
      ['sommes', 'allons'],
    ])
  }, 30_000) // the first dynamic import of the Excel reader can be slow on a busy machine

  it('rejects a broken workbook', async () => {
    await expect(readTableFile(new File(['not a zip'], 'broken.xlsx'))).rejects.toMatchObject({ key: 'import.errors.excel' })
  })
})

describe('detectColumns', () => {
  it('finds a language header and pre-fills the languages', () => {
    const g = detectColumns([
      ['Nr', 'Englisch', 'Deutsch'],
      ['1', 'house', 'Haus'],
    ])
    expect(g).toEqual({ header: true, sourceCol: 1, targetCol: 2, sourceLanguage: 'Englisch', targetLanguage: 'Deutsch', extraCols: [] })
  })

  it("follows the set's languages when the header has them in another order", () => {
    const g = detectColumns(
      [
        ['Deutsch', 'Französisch'],
        ['Haus', 'maison'],
      ],
      { source: 'French', target: 'German' },
    )
    expect([g.sourceCol, g.targetCol]).toEqual([1, 0])
  })

  it('keeps textbook columns such as Unit and Seite as extra columns', () => {
    const g = detectColumns([
      ['Unit', 'Seite', 'Nr', 'Französisch', 'Deutsch'],
      ['1', '8', '1', 'la maison', 'das Haus'],
    ])
    expect([g.header, g.sourceCol, g.targetCol, g.extraCols]).toEqual([true, 3, 4, [0, 1]])
  })

  it('recognises generic header words', () => {
    expect(detectColumns([['Term', 'Definition'], ['a', 'b']]).header).toBe(true)
  })

  it('treats ordinary first rows as entries and skips empty columns', () => {
    const g = detectColumns([
      ['', 'house', 'Haus'],
      ['', 'dog', 'Hund'],
    ])
    expect(g).toEqual({ header: false, sourceCol: 1, targetCol: 2, extraCols: [] })
  })
})

describe('helpers', () => {
  it('derives a title from the file name', () => {
    expect(titleFromFileName('Unit_4 Vocabulary.xlsx')).toBe('Unit 4 Vocabulary')
  })

  it('builds conjugation tables from imported rows', () => {
    expect(
      gridFromRows([
        ['', 'être', 'aller'],
        ['je', 'suis', 'vais'],
      ]),
    ).toEqual({ rows: ['je'], cols: ['être', 'aller'], cells: [['suis', 'vais']] })
  })
})
