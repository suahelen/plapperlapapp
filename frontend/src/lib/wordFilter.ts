import type { FieldValues, WordFilter } from '@/models'

/**
 * Extra columns of a word (unit, page, …), stored as metadata.fields. Mirrors
 * Filter.Matches in backend/internal/activities/filter.go.
 */
export function fieldsOf(metadata: Record<string, unknown> | undefined): Record<string, string> {
  const f = metadata?.fields
  return f && typeof f === 'object' && !Array.isArray(f) ? (f as Record<string, string>) : {}
}

/** True if the word's extra columns pass the filter (AND across columns, OR within one). */
export function matchesFilter(metadata: Record<string, unknown> | undefined, filter: WordFilter | undefined): boolean {
  const entries = Object.entries(filter ?? {}).filter(([, values]) => values.length > 0)
  if (entries.length === 0) return true
  const fields = fieldsOf(metadata)
  return entries.every(([key, values]) => key in fields && values.includes(fields[key]))
}

/** Distinct values per extra column with counts, sorted naturally ("2" before "10"). */
export function fieldValues(items: { metadata?: Record<string, unknown> }[]): FieldValues {
  const counts = new Map<string, Map<string, number>>()
  for (const item of items) {
    for (const [key, value] of Object.entries(fieldsOf(item.metadata))) {
      const values = counts.get(key) ?? new Map<string, number>()
      values.set(value, (values.get(value) ?? 0) + 1)
      counts.set(key, values)
    }
  }
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  const out: FieldValues = {}
  for (const key of [...counts.keys()].sort(collator.compare)) {
    out[key] = [...counts.get(key)!.entries()]
      .sort(([a], [b]) => collator.compare(a, b))
      .map(([value, count]) => ({ value, count }))
  }
  return out
}

/** Drops columns without chosen values, so an untouched filter is {}. */
export function cleanFilter(filter: WordFilter): WordFilter {
  return Object.fromEntries(Object.entries(filter).filter(([, values]) => values.length > 0))
}
