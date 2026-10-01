import { describe, expect, it } from 'vitest'
import { isGridSet, itemsToTable, parseGridPaste, tableToItems } from './grid'

const pasted = '\têtre\taller\nje\tsuis\tvais\ntu\tes\tvas\nnous\tsommes\t\n'

describe('conjugation tables', () => {
  it('parses a pasted table with header row and column', () => {
    expect(parseGridPaste(pasted)).toEqual({
      rows: ['je', 'tu', 'nous'],
      cols: ['être', 'aller'],
      cells: [
        ['suis', 'vais'],
        ['es', 'vas'],
        ['sommes', ''],
      ],
    })
    expect(parseGridPaste('just one line')).toBeNull()
  })

  it('converts to items usable by every game, skipping empty cells', () => {
    const items = tableToItems(parseGridPaste(pasted)!)
    expect(items).toHaveLength(5)
    expect(items[0]).toEqual({ source: 'je (être)', target: 'suis', metadata: { grid: { row: 'je', col: 'être' } } })
    expect(isGridSet(items)).toBe(true)
    expect(isGridSet([{ source: 'a', target: 'b' }])).toBe(false)
  })

  it('round-trips items back to the table', () => {
    const table = parseGridPaste(pasted)!
    expect(itemsToTable(tableToItems(table))).toEqual(table)
  })
})
