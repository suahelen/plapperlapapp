import { describe, expect, it } from 'vitest'
import { cleanFilter, fieldValues, matchesFilter } from './wordFilter'

const word = (fields?: Record<string, string>) => ({ metadata: fields ? { fields } : undefined })

describe('word filter', () => {
  it('keeps words matching every chosen column (same rules as the backend)', () => {
    const f = { Unit: ['3', '4'], Wortart: ['Verb'] }
    expect(matchesFilter(word({ Unit: '3', Wortart: 'Verb' }).metadata, f)).toBe(true)
    expect(matchesFilter(word({ Unit: '5', Wortart: 'Verb' }).metadata, f)).toBe(false)
    expect(matchesFilter(word({ Unit: '3' }).metadata, f)).toBe(false)
    expect(matchesFilter(undefined, f)).toBe(false)
    expect(matchesFilter(undefined, {})).toBe(true)
    expect(matchesFilter(word({ Unit: '1' }).metadata, { Unit: [] })).toBe(true)
  })

  it('lists column values with counts in natural order', () => {
    const items = [word({ Unit: '10' }), word({ Unit: '2' }), word({ Unit: '2', Seite: '5' }), word()]
    expect(fieldValues(items)).toEqual({
      Seite: [{ value: '5', count: 1 }],
      Unit: [
        { value: '2', count: 2 },
        { value: '10', count: 1 },
      ],
    })
  })

  it('removes empty columns from a filter', () => {
    expect(cleanFilter({ Unit: ['1'], Seite: [] })).toEqual({ Unit: ['1'] })
  })
})
