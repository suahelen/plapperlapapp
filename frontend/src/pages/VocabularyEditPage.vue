<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { copySet, createSet, getSet, updateSet } from '@/api/vocabulary'
import { errorMessage } from '@/api/client'
import type { Role, VocabularySetInput } from '@/models'
import { fieldValues, fieldsOf } from '@/lib/wordFilter'
import ShareDialog from '@/components/ShareDialog.vue'
import { parsePaste, type PastedEntry } from '@/lib/parsePaste'
import PastePreview, { type ImportResult, type ImportSource } from '@/components/PastePreview.vue'
import ConjugationTable from '@/components/ConjugationTable.vue'
import { gridFromRows, gridOf, isGridSet, itemsToTable, tableToItems, type GridTable } from '@/lib/grid'
import { ACCEPTED_FILES, detectColumns, ImportError, readTableFile, titleFromFileName } from '@/lib/importFile'
import { LANGUAGE_SUGGESTIONS, languageCode } from '@/lib/languages'

const props = defineProps<{ id?: string }>()
const { t } = useI18n()
const router = useRouter()

interface Row {
  key: number
  id?: string
  source: string
  target: string
  metadata?: Record<string, unknown>
}

let nextKey = 1
const blankRow = (): Row => ({ key: nextKey++, source: '', target: '' })

const title = ref('')
const sourceLanguage = ref('')
const targetLanguage = ref('')
// Speech recognition needs to know the language; flag names it can't map to a code.
const unknownLanguages = computed(() =>
  [sourceLanguage.value, targetLanguage.value].filter((n) => n.trim() !== '' && !languageCode(n)),
)
const rows = ref<Row[]>([blankRow(), blankRow(), blankRow()])

const loading = ref(!!props.id)
const saving = ref(false)
const error = ref('')
const savedAt = ref<Date | null>(null)
const showErrors = ref(false)

const pasteText = ref('')
const showPasteBox = ref(false)
const pendingTable = ref<ImportSource | null>(null)
const fileInput = ref<HTMLInputElement>()
const importing = ref(false)
const dragOver = ref(false)
const importError = ref('')
const table = ref<HTMLTableElement>()

// "table" mode edits a conjugation table (rows × columns). It is saved as ordinary
// items with grid metadata, so every game can use it.
const mode = ref<'list' | 'table'>('list')
const DEFAULT_ROWS = ['je', 'tu', 'il/elle', 'nous', 'vous', 'ils/elles']
const blankTable = (): GridTable => ({
  rows: [...DEFAULT_ROWS],
  cols: ['', '', ''],
  cells: DEFAULT_ROWS.map(() => ['', '', '']),
})
const gridTable = ref<GridTable>(blankTable())
// Item IDs per table cell, so saving a table again updates items instead of recreating them.
let gridIds = new Map<string, string>()
const gridKey = (row: string, col: string) => `${row}\u0000${col}`

function loadItems(items: Omit<Row, 'key'>[]) {
  gridIds = new Map()
  for (const i of items) {
    const g = gridOf(i)
    if (g && i.id) gridIds.set(gridKey(g.row, g.col), i.id)
  }
  if (isGridSet(items)) {
    mode.value = 'table'
    gridTable.value = itemsToTable(items)
  }
  rows.value = [...items.map((i) => ({ ...i, key: nextKey++ })), blankRow()]
  extraFields.value = []
  syncExtraFields()
}

function switchMode(next: 'list' | 'table') {
  if (next === mode.value) return
  if (next === 'table') {
    const gridItems = rows.value.filter((r) => gridOf(r))
    gridTable.value = gridItems.length ? itemsToTable(gridItems) : blankTable()
  } else {
    rows.value = [...tableToItems(gridTable.value).map((i) => ({ ...i, key: nextKey++ })), blankRow()]
  }
  mode.value = next
}

const tableCount = computed(() => tableToItems(gridTable.value).length)

// --- sharing --------------------------------------------------------------
const role = ref<Role>('owner')
const ownerEmail = ref('')
const usedByOthers = ref(0)
const readOnly = computed(() => role.value === 'viewer')
const showShare = ref(false)
const copying = ref(false)

async function load(id: string | undefined) {
  if (!id) return
  loading.value = true
  error.value = ''
  try {
    const set = await getSet(id)
    title.value = set.title
    sourceLanguage.value = set.sourceLanguage
    targetLanguage.value = set.targetLanguage
    role.value = set.role
    ownerEmail.value = set.ownerEmail
    usedByOthers.value = set.usedByOthers ?? 0
    loadItems(set.items ?? [])
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}
onMounted(() => load(props.id))
// The same page shows the copy after "Kopie erstellen".
watch(
  () => props.id,
  (id) => {
    showShare.value = false
    void load(id)
  },
)

async function copy() {
  if (!props.id) return
  copying.value = true
  try {
    const created = await copySet(props.id, t('common.copySuffix'))
    router.push(`/vocabulary/${created.id}`)
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    copying.value = false
  }
}

// --- extra columns (unit, page, …: metadata.fields) -------------------------
const extraFields = ref<string[]>([])
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function syncExtraFields() {
  const names = new Set(extraFields.value)
  for (const r of rows.value) Object.keys(fieldsOf(r.metadata)).forEach((n) => names.add(n))
  extraFields.value = [...names]
}

function setField(row: Row, name: string, value: string) {
  const fields = { ...fieldsOf(row.metadata) }
  if (value.trim()) fields[name] = value
  else delete fields[name]
  const { fields: _old, ...rest } = row.metadata ?? {}
  row.metadata = Object.keys(fields).length ? { ...rest, fields } : Object.keys(rest).length ? rest : undefined
}

const newField = ref<string | null>(null)
function addField() {
  const name = newField.value?.trim()
  if (name && !extraFields.value.includes(name)) extraFields.value = [...extraFields.value, name]
  newField.value = null
}
function removeField(name: string) {
  for (const r of rows.value) setField(r, name, '')
  extraFields.value = extraFields.value.filter((n) => n !== name)
  if (filterField.value === name) filterField.value = ''
}

// Filter the visible rows by one extra column value (row numbers stay the same).
const filterField = ref('')
const filterValue = ref('')
const filterValues = computed(() => (filterField.value ? fieldValues(rows.value)[filterField.value] ?? [] : []))
const visibleRows = computed(() =>
  rows.value
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !filterField.value || !filterValue.value || fieldsOf(row.metadata)[filterField.value] === filterValue.value),
)

// Sorting reorders the list itself (the order is saved and used by the games).
const sortKey = ref<{ by: string; desc: boolean } | null>(null)
function sortBy(by: string) {
  const desc = sortKey.value?.by === by && !sortKey.value.desc
  sortKey.value = { by, desc }
  const value = (r: Row) => (by === '\u0000source' ? r.source : by === '\u0000target' ? r.target : fieldsOf(r.metadata)[by] ?? '')
  const filled = rows.value.filter((r) => !isEmpty(r)).sort((a, b) => collator.compare(value(a), value(b)) * (desc ? -1 : 1))
  rows.value = [...filled, blankRow()]
}
const sortMark = (by: string) => (sortKey.value?.by === by ? (sortKey.value.desc ? ' ▼' : ' ▲') : '')

const isEmpty = (r: Row) => r.source.trim() === '' && r.target.trim() === ''
const isIncomplete = (r: Row) => !isEmpty(r) && (r.source.trim() === '' || r.target.trim() === '')
const filledCount = computed(() => rows.value.filter((r) => !isEmpty(r)).length)

function addRow(focus = true) {
  rows.value.push(blankRow())
  if (focus) nextTick(() => focusCell(rows.value.length - 1, 0))
}

function removeRow(index: number) {
  rows.value.splice(index, 1)
  if (rows.value.length === 0) rows.value.push(blankRow())
}

function focusCell(row: number, col: number) {
  table.value?.querySelector<HTMLInputElement>(`[data-cell="${row}-${col}"]`)?.focus()
}

/** Enter moves to the next row (creating one at the end), like a spreadsheet. */
function onEnter(index: number, col: number) {
  if (index === rows.value.length - 1) addRow(false)
  nextTick(() => focusCell(index + 1, col))
}

// --- pasting --------------------------------------------------------------
function appendEntries(entries: PastedEntry[]) {
  // Replace trailing empty rows, then keep one blank row at the end.
  while (rows.value.length && isEmpty(rows.value[rows.value.length - 1])) rows.value.pop()
  rows.value.push(...entries.map((e) => ({ key: nextKey++, ...e })))
  rows.value.push(blankRow())
  pendingTable.value = null
  pasteText.value = ''
  showPasteBox.value = false
}

function handleTable(text: string) {
  const parsed = parsePaste(text)
  if (parsed.rows.length === 0) return
  // Plain two-column pastes go straight in; anything else (extra columns, a header row) gets the preview.
  if (parsed.ambiguous || detectColumns(parsed.rows).header) {
    pendingTable.value = { sheets: [{ name: '', rows: parsed.rows }] }
  } else {
    appendEntries(parsed.rows.map(([source, target]) => ({ source, target })))
  }
}

const existingEntries = computed(() => rows.value.filter((r) => !isEmpty(r)))

function applyImport(r: ImportResult) {
  const fileName = pendingTable.value?.fileName
  if (r.replace) rows.value = []
  appendEntries(r.entries)
  syncExtraFields()
  if (!sourceLanguage.value && r.sourceLanguage) sourceLanguage.value = r.sourceLanguage
  if (!targetLanguage.value && r.targetLanguage) targetLanguage.value = r.targetLanguage
  if (!title.value.trim() && fileName) title.value = titleFromFileName(fileName)
}

// --- file import ----------------------------------------------------------
async function importFile(file: File) {
  importError.value = ''
  importing.value = true
  try {
    const imported = await readTableFile(file)
    if (mode.value === 'table') {
      // A conjugation table: first row = verbs, first column = pronouns (first sheet that fits).
      const grid = imported.sheets.map((s) => gridFromRows(s.rows)).find((g) => g !== null)
      if (!grid) throw new ImportError('import.errors.notATable')
      gridTable.value = grid
      if (!title.value.trim()) title.value = titleFromFileName(file.name)
    } else {
      showPasteBox.value = false
      pendingTable.value = { ...imported, fileName: file.name }
    }
  } catch (e) {
    importError.value = e instanceof ImportError ? t(e.key, e.params) : t('import.errors.unreadable')
  } finally {
    importing.value = false
  }
}

function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // allow picking the same file again
  if (file) void importFile(file)
}

const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')
function onDragOver(e: DragEvent) {
  if (!hasFiles(e)) return
  e.preventDefault()
  dragOver.value = true
}
function onDrop(e: DragEvent) {
  dragOver.value = false
  const file = e.dataTransfer?.files?.[0]
  if (!file) return
  e.preventDefault()
  void importFile(file)
}

// An empty list shows a big drop zone (also where "Aus Datei importieren" leads).
const showDropZone = computed(
  () => mode.value === 'list' && !pendingTable.value && filledCount.value === 0,
)

/** Pasting multi-cell data straight into the table is treated as a table paste. */
function onCellPaste(e: ClipboardEvent) {
  const text = e.clipboardData?.getData('text/plain') ?? ''
  if (!/[\t\n]/.test(text.trim())) return
  e.preventDefault()
  handleTable(text)
}

// --- saving ---------------------------------------------------------------
async function save() {
  error.value = ''
  showErrors.value = true
  if (!title.value.trim()) {
    error.value = t('vocab.needTitle')
    return
  }
  if (mode.value === 'list' && rows.value.some(isIncomplete)) {
    error.value = t('vocab.incompleteRows')
    return
  }
  const input: VocabularySetInput = {
    title: title.value,
    sourceLanguage: sourceLanguage.value,
    targetLanguage: targetLanguage.value,
    items:
      mode.value === 'table'
        ? tableToItems(gridTable.value).map((i) => {
            const g = gridOf(i)!
            return { ...i, id: gridIds.get(gridKey(g.row, g.col)) }
          })
        : rows.value
            .filter((r) => !isEmpty(r))
            .map((r) => ({ id: r.id, source: r.source, target: r.target, metadata: r.metadata })),
  }
  saving.value = true
  try {
    const saved = props.id ? await updateSet(props.id, input) : await createSet(input)
    loadItems(saved.items ?? [])
    savedAt.value = new Date()
    showErrors.value = false
    if (!props.id) router.replace(`/vocabulary/${saved.id}`)
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <main class="container stack">
    <div class="row">
      <RouterLink to="/vocabulary" class="btn btn-ghost">← {{ t('nav.vocabulary') }}</RouterLink>
      <div class="spacer" />
      <template v-if="id && !loading">
        <button class="btn" type="button" :disabled="copying" @click="copy">⧉ {{ t('share.makeCopy') }}</button>
        <button v-if="role === 'owner'" class="btn" type="button" @click="showShare = !showShare">👥 {{ t('share.button') }}</button>
      </template>
    </div>

    <p v-if="loading" class="muted">{{ t('common.loading') }}</p>
    <template v-else>
      <div v-if="role === 'viewer'" class="notice viewer" role="status">
        👁 {{ t('share.viewOnly', { email: ownerEmail }) }}
        <button class="btn btn-primary" type="button" :disabled="copying" @click="copy">{{ t('share.makeCopy') }}</button>
      </div>
      <div v-else-if="role === 'editor'" class="notice" role="status">✏️ {{ t('share.canEdit', { email: ownerEmail }) }}</div>
      <div v-else-if="usedByOthers > 0" class="notice" role="status">
        👥 {{ t('share.usedByOthers', { n: usedByOthers }, usedByOthers) }}
      </div>

      <ShareDialog v-if="showShare && id" target="vocabulary-sets" :id="id" @close="showShare = false" />

      <fieldset class="plain stack" :disabled="readOnly">
      <section class="card stack">
        <div class="field">
          <label for="title">{{ t('common.title') }}</label>
          <input id="title" v-model="title" class="input title-input" :placeholder="t('vocab.titlePlaceholder')" maxlength="200" />
        </div>
        <div class="row langs">
          <div class="field">
            <label for="src-lang">{{ t('vocab.sourceLanguage') }}</label>
            <input id="src-lang" v-model="sourceLanguage" class="input" :placeholder="t('vocab.sourcePlaceholder')" maxlength="50" list="language-names" />
          </div>
          <span class="arrow" aria-hidden="true">→</span>
          <div class="field">
            <label for="tgt-lang">{{ t('vocab.targetLanguage') }}</label>
            <input id="tgt-lang" v-model="targetLanguage" class="input" :placeholder="t('vocab.targetPlaceholder')" maxlength="50" list="language-names" />
          </div>
          <datalist id="language-names">
            <option v-for="n in LANGUAGE_SUGGESTIONS" :key="n" :value="n" />
          </datalist>
        </div>
        <p v-if="unknownLanguages.length" class="muted" style="margin: 0; font-size: 0.88rem">
          🎤 {{ t('vocab.unknownLanguage', { names: unknownLanguages.join(', ') }) }}
        </p>
      </section>

      <section
        class="card stack words"
        :class="{ dragging: dragOver }"
        @dragover="onDragOver"
        @dragleave.self="dragOver = false"
        @drop="onDrop"
      >
        <div v-if="dragOver" class="drop-overlay" aria-hidden="true">📄 {{ t('vocab.dropHere') }}</div>
        <div class="row">
          <h2 style="margin: 0">
            {{ t('vocab.words') }} <span class="badge">{{ mode === 'table' ? tableCount : filledCount }}</span>
          </h2>
          <div class="mode-toggle" role="group" :aria-label="t('vocab.inputMode')">
            <button type="button" :class="{ on: mode === 'list' }" @click="switchMode('list')">{{ t('vocab.modeList') }}</button>
            <button type="button" :class="{ on: mode === 'table' }" @click="switchMode('table')">{{ t('vocab.modeTable') }}</button>
          </div>
          <div class="spacer" />
          <button class="btn" type="button" :disabled="importing" @click="fileInput?.click()">
            📄 {{ importing ? t('vocab.reading') : t('vocab.importFile') }}
          </button>
          <button v-if="mode === 'list'" class="btn" type="button" @click="showPasteBox = !showPasteBox">
            📋 {{ t('vocab.pasteTable') }}
          </button>
          <input ref="fileInput" type="file" :accept="ACCEPTED_FILES" hidden @change="onFilePicked" />
        </div>

        <div v-if="importError" class="alert" role="alert">{{ importError }}</div>

        <button v-if="showDropZone" type="button" class="dropzone" :disabled="importing" @click="fileInput?.click()">
          <span class="dz-icon" aria-hidden="true">📄</span>
          <strong>{{ t('vocab.dropTitle') }}</strong>
          <span class="muted">{{ t('vocab.dropText') }}</span>
        </button>

        <template v-if="mode === 'table'">
          <p class="muted" style="margin: 0">{{ t('vocab.tableHelp') }}</p>
          <ConjugationTable v-model="gridTable" />
        </template>

        <div v-if="mode === 'list' && showPasteBox && !pendingTable" class="paste-box stack">
          <p class="muted" style="margin: 0">{{ t('vocab.pasteHelp') }}</p>
          <textarea v-model="pasteText" rows="6" :placeholder="t('vocab.pastePlaceholder')" />
          <div class="row">
            <button class="btn btn-accent" type="button" :disabled="!pasteText.trim()" @click="handleTable(pasteText)">
              {{ t('import.apply') }}
            </button>
            <button class="btn btn-ghost" type="button" @click="showPasteBox = false">{{ t('common.cancel') }}</button>
          </div>
        </div>

        <PastePreview
          v-if="mode === 'list' && pendingTable"
          :source="pendingTable"
          :existing="existingEntries"
          :set-languages="{ source: sourceLanguage, target: targetLanguage }"
          @confirm="applyImport"
          @cancel="pendingTable = null"
        />

        <div v-if="mode === 'list' && extraFields.length" class="row filter-bar">
          <label for="filter-field">{{ t('vocab.filter') }}</label>
          <select id="filter-field" v-model="filterField" @change="filterValue = ''">
            <option value="">{{ t('vocab.filterAll') }}</option>
            <option v-for="f in extraFields" :key="f" :value="f">{{ f }}</option>
          </select>
          <select v-if="filterField" v-model="filterValue" :aria-label="filterField">
            <option value="">{{ t('vocab.filterAll') }}</option>
            <option v-for="v in filterValues" :key="v.value" :value="v.value">{{ v.value }} ({{ v.count }})</option>
          </select>
          <span v-if="filterField && filterValue" class="muted">{{ t('vocab.shown', { n: visibleRows.length, total: filledCount }) }}</span>
        </div>

        <div v-if="mode === 'list'" class="table-wrap">
          <table ref="table" class="vocab-table">
            <thead>
              <tr>
                <th class="num">#</th>
                <th><button type="button" class="sort" @click="sortBy('\u0000source')">{{ sourceLanguage || t('vocab.sourceLanguage') }}{{ sortMark('\u0000source') }}</button></th>
                <th><button type="button" class="sort" @click="sortBy('\u0000target')">{{ targetLanguage || t('vocab.targetLanguage') }}{{ sortMark('\u0000target') }}</button></th>
                <th v-for="f in extraFields" :key="f" class="extra">
                  <button type="button" class="sort" @click="sortBy(f)">{{ f }}{{ sortMark(f) }}</button>
                  <button type="button" class="x" :aria-label="t('vocab.removeColumn', { name: f })" @click="removeField(f)">✕</button>
                </th>
                <th class="actions">
                  <input
                    v-if="newField !== null"
                    v-model="newField"
                    class="new-field"
                    maxlength="40"
                    :placeholder="t('vocab.columnName')"
                    :aria-label="t('vocab.columnName')"
                    @keydown.enter.prevent="addField"
                    @keydown.esc="newField = null"
                    @blur="addField"
                  />
                  <button v-else type="button" class="btn btn-ghost btn-icon" :title="t('vocab.addColumn')" :aria-label="t('vocab.addColumn')" @click="newField = ''">＋</button>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="{ row, index: i } in visibleRows" :key="row.key" :class="{ incomplete: showErrors && isIncomplete(row) }">
                <td class="num">{{ i + 1 }}</td>
                <td>
                  <input
                    v-model="row.source"
                    class="cell"
                    :data-cell="`${i}-0`"
                    :aria-label="t('vocab.cellSource', { n: i + 1 })"
                    @keydown.enter.prevent="onEnter(i, 0)"
                    @paste="onCellPaste"
                  />
                </td>
                <td>
                  <input
                    v-model="row.target"
                    class="cell"
                    :data-cell="`${i}-1`"
                    :aria-label="t('vocab.cellTarget', { n: i + 1 })"
                    @keydown.enter.prevent="onEnter(i, 1)"
                    @paste="onCellPaste"
                  />
                </td>
                <td v-for="f in extraFields" :key="f" class="extra">
                  <input
                    class="cell"
                    :value="fieldsOf(row.metadata)[f] ?? ''"
                    maxlength="100"
                    :aria-label="`${f} · ${i + 1}`"
                    @input="setField(row, f, ($event.target as HTMLInputElement).value)"
                  />
                </td>
                <td class="actions">
                  <button class="btn btn-ghost btn-icon del" type="button" :aria-label="t('conj.deleteRow', { n: i + 1 })" @click="removeRow(i)">
                    ✕
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="mode === 'list'">
          <button class="btn btn-ghost" type="button" @click="addRow()">+ {{ t('conj.addRow') }}</button>
        </div>
      </section>
      </fieldset>

      <div v-if="readOnly && error" class="alert" role="alert">{{ error }}</div>
      <div v-if="!readOnly" class="save-bar">
        <div v-if="error" class="alert" role="alert">{{ error }}</div>
        <div class="row">
          <button class="btn btn-primary btn-lg" type="button" :disabled="saving" @click="save">
            {{ saving ? t('common.saving') : t('common.save') }}
          </button>
          <span v-if="savedAt && !error" class="saved">{{ t('common.saved') }}</span>
          <div class="spacer" />
          <RouterLink v-if="id" to="/activities/new" class="btn btn-ghost">{{ t('activity.create') }} →</RouterLink>
        </div>
      </div>
    </template>
  </main>
</template>

<style scoped>
.title-input {
  font-size: 1.2rem;
  font-weight: 700;
}
.langs {
  align-items: flex-end;
}
.langs .field {
  flex: 1;
  min-width: 140px;
}
.arrow {
  padding-bottom: 10px;
  color: var(--muted);
  font-size: 1.2rem;
}
.mode-toggle {
  display: inline-flex;
  padding: 3px;
  border-radius: 999px;
  background: var(--surface-2);
}
.mode-toggle button {
  padding: 6px 14px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  font: 600 0.9rem var(--font);
  cursor: pointer;
}
.mode-toggle button.on {
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--shadow-sm);
}
.words {
  position: relative;
}
.words.dragging {
  outline: 3px dashed var(--accent);
  outline-offset: -3px;
}
.drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: grid;
  place-items: center;
  border-radius: inherit;
  background: color-mix(in srgb, var(--accent-soft) 88%, transparent);
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--accent);
  pointer-events: none;
}
.dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 22px 16px;
  border: 2px dashed var(--line);
  border-radius: var(--radius);
  background: var(--bg);
  font: inherit;
  color: var(--ink);
  cursor: pointer;
  text-align: center;
  transition:
    border-color 0.15s,
    background 0.15s;
}
.dropzone:hover,
.dropzone:focus-visible {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.dz-icon {
  font-size: 1.8rem;
}
.paste-box {
  padding: 16px;
  background: var(--surface-2);
  border-radius: var(--radius-sm);
}
.table-wrap {
  overflow-x: auto;
}
.vocab-table {
  width: 100%;
  border-collapse: collapse;
}
.vocab-table th {
  text-align: left;
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  padding: 6px 8px;
}
.vocab-table td {
  padding: 3px 4px;
  border-top: 1px solid var(--line);
}
.num {
  width: 36px;
  text-align: right;
  color: var(--muted);
  font-size: 0.85rem;
}
.actions {
  width: 48px;
}
.cell {
  width: 100%;
  min-width: 120px;
  padding: 9px 10px;
  border: 1.5px solid transparent;
  border-radius: 8px;
  background: transparent;
  font: 1rem var(--font);
  color: var(--ink);
}
.cell:hover {
  background: var(--surface-2);
}
.cell:focus {
  outline: none;
  background: var(--surface-bright);
  border-color: var(--accent);
}
tr.incomplete .cell {
  background: var(--bad-soft);
}
.del {
  color: var(--muted);
  opacity: 0.5;
}
tr:hover .del,
.del:focus-visible {
  opacity: 1;
}
.filter-bar {
  gap: 8px;
  align-items: center;
}
.filter-bar select {
  font: inherit;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line);
  background: var(--surface-bright);
  color: var(--ink);
}
.sort {
  border: 0;
  background: none;
  padding: 0;
  font: inherit;
  font-weight: inherit;
  color: inherit;
  cursor: pointer;
  text-align: left;
}
.sort:hover {
  color: var(--ink);
  text-decoration: underline;
}
th.extra,
td.extra {
  background: color-mix(in srgb, var(--player-yellow) 10%, transparent);
  min-width: 90px;
}
th.extra {
  white-space: nowrap;
}
th.extra .x {
  border: 0;
  background: none;
  color: var(--muted);
  cursor: pointer;
  padding: 0 0 0 6px;
  font-size: 0.8rem;
}
fieldset:disabled th.extra .x,
fieldset:disabled .actions {
  visibility: hidden;
}
.new-field {
  width: 120px;
  font: inherit;
  font-size: 0.85rem;
  padding: 4px 6px;
  border: 1px solid var(--accent);
  border-radius: 6px;
}

.save-bar {
  position: sticky;
  bottom: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 0 max(12px, env(safe-area-inset-bottom));
  background: linear-gradient(transparent, var(--bg) 30%);
}
.saved {
  color: var(--good);
  font-weight: 700;
}
</style>
