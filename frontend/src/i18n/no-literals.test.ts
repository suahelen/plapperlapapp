import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Heuristic guard: visible text in templates must come from the catalogues (t(), gt()),
// so no language is hard-coded. Flags text nodes and static user-facing attributes that
// contain words. Symbols, emoji, numbers and interpolations are fine.
const SRC = fileURLToPath(new URL('..', import.meta.url))
// Developer-only component, compiled out of production builds.
const ALLOW_FILES = new Set(['components/TestModeBadge.vue'])

function vueFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return vueFiles(path)
    return name.endsWith('.vue') ? [path] : []
  })
}

const WORD = /\p{L}{2,}/u

function literals(template: string): string[] {
  const out: string[] = []
  const clean = template.replace(/<!--[\s\S]*?-->/g, '')
  for (const m of clean.matchAll(/>([^<>]+)</g)) {
    const text = m[1].replace(/\{\{[\s\S]*?\}\}/g, '').trim()
    if (text.includes('="')) continue // a ">" inside an attribute value, not a text node
    if (WORD.test(text)) out.push(text)
  }
  for (const m of clean.matchAll(/\s(title|placeholder|aria-label|label|alt|intro|subtitle)="([^"]*)"/g)) {
    if (WORD.test(m[2])) out.push(`${m[1]}="${m[2]}"`)
  }
  return out
}

describe('no hard-coded UI text', () => {
  it('templates use message keys for all visible text', () => {
    const offenders: string[] = []
    for (const path of vueFiles(SRC)) {
      const where = relative(SRC, path).replace(/\\/g, '/')
      if (ALLOW_FILES.has(where)) continue
      const template = readFileSync(path, 'utf8').match(/<template>([\s\S]*)<\/template>/)?.[1] ?? ''
      for (const text of literals(template)) offenders.push(`${where}: ${text}`)
    }
    expect(offenders).toEqual([])
  })
})
