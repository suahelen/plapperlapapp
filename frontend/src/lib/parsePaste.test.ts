import { describe, expect, it } from 'vitest'
import { parsePaste, toEntries } from './parsePaste'

describe('parsePaste', () => {
  it('parses two tab-separated columns and ignores empty rows', () => {
    const t = parsePaste('house\tHaus\r\n\n  \ndog\tHund\ncat\tKatze\n')
    expect(t.rows).toEqual([
      ['house', 'Haus'],
      ['dog', 'Hund'],
      ['cat', 'Katze'],
    ])
    expect(t.ambiguous).toBe(false)
    expect(t.columnCount).toBe(2)
  })

  it('flags rows with other column counts as ambiguous', () => {
    const t = parsePaste('house\tHaus\tnoun\ndog\tHund')
    expect(t.ambiguous).toBe(true)
    expect(t.columnCount).toBe(3)
    expect(parsePaste('just one word').ambiguous).toBe(true)
  })

  it('strips spreadsheet quoting and whitespace', () => {
    expect(parsePaste(' "a ""b"""\t Baum ').rows).toEqual([['a "b"', 'Baum']])
  })
})

describe('toEntries', () => {
  it('maps chosen columns and skips incomplete rows', () => {
    const rows = [
      ['1', 'house', 'Haus'],
      ['2', 'dog', ''],
      ['3', 'cat', 'Katze'],
    ]
    expect(toEntries(rows, 1, 2)).toEqual({
      entries: [
        { source: 'house', target: 'Haus' },
        { source: 'cat', target: 'Katze' },
      ],
      skipped: 1,
    })
  })
})

describe('parsePaste with other separators', () => {
  it('recognises semicolon and comma separated text', () => {
    expect(parsePaste('house;Haus\ndog;Hund').rows).toEqual([
      ['house', 'Haus'],
      ['dog', 'Hund'],
    ])
    expect(parsePaste('house, Haus\ndog, Hund').rows).toEqual([
      ['house', 'Haus'],
      ['dog', 'Hund'],
    ])
  })

  it('keeps commas inside cells of tab-separated text', () => {
    expect(parsePaste('big, large\tgross\ndog\tHund').rows).toEqual([
      ['big, large', 'gross'],
      ['dog', 'Hund'],
    ])
  })
})
