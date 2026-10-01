import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Keeps colours in one place: src/theme.css.
const SRC = fileURLToPath(new URL('.', import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__fixtures__' ? [] : sourceFiles(path)
    return /\.(vue|ts|css)$/.test(name) && !/\.test\.ts$/.test(name) && !/\.d\.ts$/.test(name) ? [path] : []
  })
}

const files = sourceFiles(SRC).map((path) => ({ path: relative(SRC, path).replace(/\\/g, '/'), text: readFileSync(path, 'utf8') }))
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b(?![-\w])|\b(?:rgba?|hsla?)\(/g

describe('theme', () => {
  it('defines colours only in theme.css', () => {
    const offenders = files
      .filter((f) => f.path !== 'theme.css')
      .flatMap((f) =>
        f.text.split('\n').flatMap((line, i) =>
          // "#" followed by hex also appears in URLs/anchors ("#top"); only flag colour-like uses.
          [...line.matchAll(COLOR_LITERAL)]
            .filter((m) => !/href=|url\(|to=|#[a-f0-9]{3,8}\w*-/.test(line.slice(Math.max(0, m.index! - 12), m.index! + 12)))
            .map(() => `${f.path}:${i + 1}: ${line.trim()}`),
        ),
      )
    expect(offenders).toEqual([])
  })

  it('only references CSS variables that are defined somewhere', () => {
    const all = files.map((f) => f.text).join('\n')
    const defined = new Set([...all.matchAll(/(--[a-z0-9-]+)\s*:|['"`](--[a-z0-9-]+)['"`]/g)].map((m) => m[1] ?? m[2]))
    const used = new Set([...all.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]))
    expect([...used].filter((v) => !defined.has(v)).sort()).toEqual([])
  })
})
