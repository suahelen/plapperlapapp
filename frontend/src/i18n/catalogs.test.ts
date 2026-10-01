import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import { SUPPORTED } from '.'

// Guards for the translation catalogues:
// - every key the code uses exists in German (the fallback),
// - every other language has exactly the German keys, with the same placeholders
//   and the same number of plural forms.
const SRC = fileURLToPath(new URL('..', import.meta.url))
type Tree = { [k: string]: string | Tree }

const readJson = (path: string): Tree => JSON.parse(readFileSync(path, 'utf8'))
const gameIds = readdirSync(join(SRC, 'games')).filter((d) => {
  try {
    return statSync(join(SRC, 'games', d, 'i18n')).isDirectory()
  } catch {
    return false
  }
})

/** The full catalogue for a language, as the app assembles it (games under `games.<id>`). */
function catalog(locale: string): Tree {
  const games: Tree = {}
  for (const id of gameIds) games[id] = readJson(join(SRC, 'games', id, 'i18n', `${locale}.json`))
  return { ...readJson(join(SRC, 'i18n', 'locales', `${locale}.json`)), games }
}

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out.set(key, v)
    else for (const [kk, vv] of flatten(v, key)) out.set(kk, vv)
  }
  return out
}

const placeholders = (msg: string) => [...msg.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
const pluralForms = (msg: string) => msg.split('|').length

const german = flatten(catalog('de'))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__fixtures__' ? [] : sourceFiles(path)
    return /\.(vue|ts)$/.test(name) && !/\.(test|d)\.ts$/.test(name) ? [path] : []
  })
}

/** Keys used in the code: t('…'), $t('…'), keypath="…", gt('…') (per game) and label keys. */
function usedKeys(): { key: string; where: string }[] {
  const out: { key: string; where: string }[] = []
  for (const path of sourceFiles(SRC)) {
    const where = relative(SRC, path).replace(/\\/g, '/')
    const text = readFileSync(path, 'utf8')
    const game = where.match(/^games\/([^/]+)\//)?.[1]
    for (const m of text.matchAll(/(?<![\w.])\$?t\(\s*'([\w.-]+)'/g)) out.push({ key: m[1], where })
    for (const m of text.matchAll(/keypath="([\w.-]+)"/g)) out.push({ key: m[1], where })
    if (game) {
      for (const m of text.matchAll(/\bgt\(\s*'([\w.-]+)'/g)) out.push({ key: `games.${game}.${m[1]}`, where })
      // Dynamic game keys such as gt(`colors.${color}`): the prefix must exist.
      for (const m of text.matchAll(/\bgt\(\s*`([\w.-]+)\.\$\{/g)) out.push({ key: `games.${game}.${m[1]}.*`, where })
    }
    for (const m of text.matchAll(/new ImportError\(\s*'([\w.-]+)'/g)) out.push({ key: m[1], where })
    for (const m of text.matchAll(/label: '((?:settings|games|answer)\.[\w.-]+)'/g)) out.push({ key: m[1], where })
  }
  return out
}

describe('translation catalogues', () => {
  it('has German texts for every key the code uses', () => {
    const missing = usedKeys()
      .filter(({ key }) => (key.endsWith('.*') ? ![...german.keys()].some((k) => k.startsWith(key.slice(0, -1))) : !german.has(key)))
      .map(({ key, where }) => `${key}  (${where})`)
    expect([...new Set(missing)]).toEqual([])
  })

  it('gives every game a name and description', () => {
    for (const id of gameIds) expect([german.has(`games.${id}.name`), german.has(`games.${id}.description`)]).toEqual([true, true])
  })

  it('renders every message in every language (vue-i18n message syntax)', () => {
    const problems: string[] = []
    for (const locale of SUPPORTED) {
      const errors: string[] = []
      const i18n: { global: { t: unknown } } = createI18n({
        legacy: false,
        locale,
        messages: { [locale]: catalog(locale) } as never,
        missingWarn: false,
        fallbackWarn: false,
        warnHtmlMessage: false,
      }) as never
      const t = i18n.global.t as (key: string, named: Record<string, unknown>, plural: number) => string
      for (const [key, msg] of flatten(catalog(locale))) {
        const named = Object.fromEntries([...msg.matchAll(/\{(\w+)\}/g)].map((m) => [m[1], 'X']))
        for (const n of pluralForms(msg) > 1 ? [1, 2] : [1]) {
          try {
            const out = t(key, { ...named, n }, n)
            if (!out || out === key || /\{\w+\}/.test(out)) errors.push(`${key} → "${out}"`)
          } catch (e) {
            errors.push(`${key}: ${String(e)}`)
          }
        }
      }
      problems.push(...errors.map((e) => `${locale}: ${e}`))
    }
    expect(problems).toEqual([])
  })

  for (const locale of SUPPORTED.filter((l) => l !== 'de')) {
    it(`${locale}: same keys, placeholders and plural forms as German`, () => {
      const other = flatten(catalog(locale))
      const problems: string[] = []
      for (const [key, de] of german) {
        const msg = other.get(key)
        if (msg === undefined) problems.push(`missing ${key}`)
        else if (placeholders(msg) !== placeholders(de)) problems.push(`placeholders differ in ${key}: "${msg}"`)
        else if (pluralForms(msg) !== pluralForms(de)) problems.push(`plural forms differ in ${key}: "${msg}"`)
      }
      for (const key of other.keys()) if (!german.has(key)) problems.push(`extra ${key}`)
      expect(problems).toEqual([])
    })
  }
})
