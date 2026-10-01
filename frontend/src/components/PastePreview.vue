<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed, ref, watch } from 'vue'
import { toEntries, type PastedEntry } from '@/lib/parsePaste'
import { detectColumns, MAX_ROWS, type ImportedSheet } from '@/lib/importFile'
import { normalize } from '@/games/shared/answer/check'

export interface ImportSource {
  sheets: ImportedSheet[]
  /** Set for file imports (shown in the heading). */
  fileName?: string
  truncated?: boolean
}

export interface ImportResult {
  entries: PastedEntry[]
  /** Replace the current list instead of appending. */
  replace: boolean
  /** Language names from the header row, for filling empty language fields. */
  sourceLanguage?: string
  targetLanguage?: string
}

// Preview for pasted tables and imported files: pick sheet and columns, skip the header
// row, incomplete and duplicate rows, then append to or replace the list.
const props = defineProps<{
  source: ImportSource
  existing: PastedEntry[]
  setLanguages: { source: string; target: string }
}>()
const emit = defineEmits<{ confirm: [ImportResult]; cancel: [] }>()
const { t } = useI18n()

/** What a column holds: the two languages, an extra column kept with each word (unit, page, …), or nothing. */
type ColumnRole = 'source' | 'target' | 'extra' | 'ignore'

const sheetIndex = ref(0)
const sheet = computed(() => props.source.sheets[sheetIndex.value])
const header = ref(false)
const roles = ref<ColumnRole[]>([])
/** Names the teacher typed for extra columns (otherwise the header text is used). */
const customNames = ref<Record<number, string>>({})
const replace = ref(false)
const guess = ref(detectColumns([]))

const columnCount = computed(() => sheet.value.rows.reduce((m, r) => Math.max(m, r.length), 0))
const columns = computed(() => Array.from({ length: columnCount.value }, (_, i) => i))

watch(
  sheet,
  (s) => {
    const g = detectColumns(s.rows, props.setLanguages)
    guess.value = g
    header.value = g.header
    customNames.value = {}
    roles.value = columns.value.map((c) =>
      c === g.sourceCol ? 'source' : c === g.targetCol ? 'target' : g.extraCols.includes(c) ? 'extra' : 'ignore',
    )
  },
  { immediate: true },
)

const sourceCol = computed(() => roles.value.indexOf('source'))
const targetCol = computed(() => roles.value.indexOf('target'))
const extraCols = computed(() => columns.value.filter((c) => roles.value[c] === 'extra'))

/** Source and target exist once: choosing one for a column frees the column that had it. */
function setRole(c: number, role: ColumnRole) {
  const next = [...roles.value]
  if (role === 'source' || role === 'target') next.forEach((r, i) => r === role && (next[i] = 'ignore'))
  next[c] = role
  roles.value = next
}

const dataRows = computed(() => (header.value ? sheet.value.rows.slice(1) : sheet.value.rows).slice(0, MAX_ROWS))
const extraName = (c: number) =>
  customNames.value[c]?.trim() || (header.value && sheet.value.rows[0]?.[c]) || t('import.column', { n: c + 1 })

const key = (e: PastedEntry) => `${normalize(e.source)}\u0000${normalize(e.target)}`
const result = computed(() => {
  const { entries: base, skipped } = toEntries(dataRows.value, sourceCol.value, targetCol.value)
  // Attach extra column values; toEntries keeps row order, skipping incomplete rows.
  const complete = dataRows.value.filter((r) => r[sourceCol.value] && r[targetCol.value])
  const entries = base.map((e, i) => {
    const fields = Object.fromEntries(
      extraCols.value.flatMap((c) => (complete[i][c] ? [[extraName(c), complete[i][c]]] : [])),
    )
    return Object.keys(fields).length ? { ...e, metadata: { fields } } : e
  })
  const seen = new Set(replace.value ? [] : props.existing.map(key))
  const unique: PastedEntry[] = []
  for (const e of entries) {
    const k = key(e)
    if (seen.has(k)) continue
    seen.add(k)
    unique.push(e)
  }
  return { entries: unique, skipped, duplicates: entries.length - unique.length }
})
const previewRows = computed(() => sheet.value.rows.slice(0, 8))
const summary = computed(() => {
  const { entries, skipped, duplicates } = result.value
  const parts = [t('import.willImport', { n: entries.length }, entries.length)]
  if (skipped) parts.push(t('import.skipIncomplete', { n: skipped }, skipped))
  if (duplicates) parts.push(t('import.skipDuplicates', { n: duplicates }, duplicates))
  return parts.join(' · ')
})

function confirm() {
  const headerRow = header.value ? sheet.value.rows[0] : undefined
  // Only offer header names that look like languages (detectColumns knows which).
  const lang = (c: number) =>
    headerRow && (c === guess.value.sourceCol ? guess.value.sourceLanguage : c === guess.value.targetCol ? guess.value.targetLanguage : undefined)
  emit('confirm', {
    entries: result.value.entries,
    replace: replace.value,
    sourceLanguage: lang(sourceCol.value) || undefined,
    targetLanguage: lang(targetCol.value) || undefined,
  })
}
</script>

<template>
  <div class="preview card stack">
    <div>
      <h3>{{ source.fileName ? t('import.fileTitle', { name: source.fileName }) : t('import.preview') }}</h3>
      <p class="muted" style="margin: 0">
        {{ t('import.checkColumns') }} <span class="chip src">{{ t('vocab.sourceLanguage') }}</span>
        <span class="chip tgt">{{ t('vocab.targetLanguage') }}</span>
      </p>
    </div>

    <div class="row controls">
      <div v-if="source.sheets.length > 1" class="field">
        <label for="imp-sheet">{{ t('import.sheet') }}</label>
        <select id="imp-sheet" v-model.number="sheetIndex">
          <option v-for="(s, i) in source.sheets" :key="i" :value="i">{{ s.name || t('import.sheetN', { n: i + 1 }) }}</option>
        </select>
      </div>
    </div>
    <p class="muted small" style="margin: 0">{{ t('import.rolesHelp') }}</p>

    <div class="row">
      <label class="check"><input v-model="header" type="checkbox" /> {{ t('import.headerRow') }}</label>
      <template v-if="existing.length">
        <label class="check"><input v-model="replace" type="radio" :value="false" /> {{ t('import.append') }}</label>
        <label class="check"><input v-model="replace" type="radio" :value="true" /> {{ t('import.replace') }}</label>
      </template>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th v-for="c in columns" :key="c" :class="roles[c]">
              <select
                :value="roles[c]"
                :aria-label="t('import.column', { n: c + 1 })"
                @change="setRole(c, ($event.target as HTMLSelectElement).value as ColumnRole)"
              >
                <option value="source">{{ t('vocab.sourceLanguage') }}</option>
                <option value="target">{{ t('vocab.targetLanguage') }}</option>
                <option value="extra">{{ t('import.roleExtra') }}</option>
                <option value="ignore">{{ t('import.roleIgnore') }}</option>
              </select>
              <input
                v-if="roles[c] === 'extra'"
                class="extra-name"
                :value="extraName(c)"
                maxlength="40"
                :aria-label="t('import.extraName')"
                @input="customNames = { ...customNames, [c]: ($event.target as HTMLInputElement).value }"
              />
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, ri) in previewRows"
            :key="ri"
            :class="{ head: header && ri === 0, skip: !(header && ri === 0) && (!row[sourceCol] || !row[targetCol]) }"
          >
            <td v-for="c in columns" :key="c" :class="{ src: c === sourceCol, tgt: c === targetCol, extra: roles[c] === 'extra' }">
              {{ row[c] ?? '' }}
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="sheet.rows.length > previewRows.length" class="muted small">
        {{ t('import.moreRows', { n: sheet.rows.length - previewRows.length }) }}
      </p>
    </div>

    <p style="margin: 0">
      {{ summary }}
      <span v-if="source.truncated" class="warn">{{ t('import.truncated', { n: MAX_ROWS }) }}</span>
    </p>

    <div class="row">
      <button
        class="btn btn-primary"
        type="button"
        :disabled="result.entries.length === 0 || sourceCol < 0 || targetCol < 0"
        @click="confirm"
      >
        {{ t('import.apply') }}
      </button>
      <button class="btn btn-ghost" type="button" @click="emit('cancel')">{{ t('common.cancel') }}</button>
    </div>
  </div>
</template>

<style scoped>
.preview {
  border-color: var(--accent);
}
.preview h3 {
  margin-bottom: 4px;
  word-break: break-word;
}
.controls .field {
  flex: 1;
  min-width: 160px;
}
.check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-right: 12px;
}
.chip {
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 0.85rem;
}
.chip.src,
td.src {
  background: var(--accent-soft);
  color: var(--ink);
}
.chip.tgt,
td.tgt {
  background: var(--primary-soft);
  color: var(--ink);
}
.table-wrap {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  font-size: 0.9rem;
  min-width: 100%;
}
th {
  padding: 4px;
  text-align: left;
  vertical-align: top;
  border: 1px solid var(--line);
  background: var(--bg);
}
th select,
.extra-name {
  width: 100%;
  min-width: 120px;
  font: inherit;
  font-size: 0.85rem;
  padding: 3px 6px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface-bright);
  color: var(--ink);
}
.extra-name {
  margin-top: 4px;
}
th.source {
  background: var(--accent-soft);
}
th.target {
  background: var(--primary-soft);
}
th.extra,
td.extra {
  background: color-mix(in srgb, var(--player-yellow) 14%, var(--surface));
  color: var(--ink);
}

td {
  border: 1px solid var(--line);
  padding: 6px 10px;
  white-space: nowrap;
  color: var(--muted);
}
tr.head td {
  font-weight: 700;
  background: var(--bg);
  color: var(--muted);
}
tr.skip td {
  text-decoration: line-through;
  opacity: 0.6;
}
.small {
  font-size: 0.85rem;
  margin: 6px 0 0;
}
.warn {
  display: block;
  color: var(--warn-ink);
  font-size: 0.9rem;
  margin-top: 4px;
}
</style>
