<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { nextTick, ref } from 'vue'
import { parseGridPaste, type GridTable } from '@/lib/grid'
const { t } = useI18n()

/**
 * Editable conjugation table: column headers (e.g. verbs), row headers (e.g. pronouns)
 * and one answer per cell. Pasting a whole table from a spreadsheet fills it in.
 */
const table = defineModel<GridTable>({ required: true })
const root = ref<HTMLElement>()

function update(fn: (t: GridTable) => void) {
  const t: GridTable = {
    rows: [...table.value.rows],
    cols: [...table.value.cols],
    cells: table.value.cells.map((r) => [...r]),
  }
  fn(t)
  table.value = t
}

const addRow = () => update((t) => (t.rows.push(''), t.cells.push(t.cols.map(() => ''))))
const addCol = () => update((t) => (t.cols.push(''), t.cells.forEach((r) => r.push(''))))
const removeRow = (r: number) => update((t) => (t.rows.splice(r, 1), t.cells.splice(r, 1)))
const removeCol = (c: number) => update((t) => (t.cols.splice(c, 1), t.cells.forEach((row) => row.splice(c, 1))))

function focus(r: number, c: number) {
  nextTick(() => root.value?.querySelector<HTMLInputElement>(`[data-cell="${r}-${c}"]`)?.focus())
}

/** Enter moves down, adding a row at the bottom, like a spreadsheet. */
function onEnter(r: number, c: number) {
  if (r === table.value.rows.length - 1) addRow()
  focus(r + 1, c)
}

function onPaste(e: ClipboardEvent) {
  const text = e.clipboardData?.getData('text/plain') ?? ''
  if (!/[\t\n]/.test(text.trim())) return
  const parsed = parseGridPaste(text)
  if (!parsed) return
  e.preventDefault()
  table.value = parsed
}
</script>

<template>
  <div ref="root" class="wrap" @paste="onPaste">
    <table class="conj">
      <thead>
        <tr>
          <th class="corner" />
          <th v-for="(_, c) in table.cols" :key="`h${c}`">
            <div class="head-cell">
              <input
                :value="table.cols[c]"
                class="head-input"
                :placeholder="t('conj.verb')"
                :aria-label="t('conj.column', { n: c + 1 })"
                @input="update((t) => (t.cols[c] = ($event.target as HTMLInputElement).value))"
              />
              <button class="x" type="button" :aria-label="t('conj.deleteColumn', { n: c + 1 })" @click="removeCol(c)">✕</button>
            </div>
          </th>
          <th class="add"><button class="btn btn-ghost btn-icon" type="button" :aria-label="t('conj.addColumn')" @click="addCol">＋</button></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(_, r) in table.rows" :key="`r${r}`">
          <th>
            <div class="head-cell">
              <button class="x" type="button" :aria-label="t('conj.deleteRow', { n: r + 1 })" @click="removeRow(r)">✕</button>
              <input
                :value="table.rows[r]"
                class="head-input"
                :placeholder="t('conj.pronoun')"
                :aria-label="t('conj.row', { n: r + 1 })"
                @input="update((t) => (t.rows[r] = ($event.target as HTMLInputElement).value))"
              />
            </div>
          </th>
          <td v-for="(_, c) in table.cols" :key="c">
            <input
              :value="table.cells[r][c]"
              class="cell"
              :data-cell="`${r}-${c}`"
              :aria-label="`${table.rows[r] || t('conj.row', { n: r + 1 })} · ${table.cols[c] || t('conj.column', { n: c + 1 })}`"
              autocapitalize="off"
              spellcheck="false"
              @input="update((t) => (t.cells[r][c] = ($event.target as HTMLInputElement).value))"
              @keydown.enter.prevent="onEnter(r, c)"
            />
          </td>
          <td />
        </tr>
      </tbody>
    </table>
    <button class="btn btn-ghost" type="button" @click="addRow">+ {{ t('conj.addRow') }}</button>
  </div>
</template>

<style scoped>
.wrap {
  overflow-x: auto;
}
.conj {
  border-collapse: separate;
  border-spacing: 4px;
  margin-bottom: 8px;
}
th,
td {
  padding: 0;
  font-weight: 400;
}
.head-cell {
  display: flex;
  align-items: center;
  gap: 2px;
}
.head-input,
.cell {
  width: 100%;
  min-width: 96px;
  padding: 8px 10px;
  border: 1.5px solid var(--line);
  border-radius: 8px;
  font: 1rem var(--font);
  color: var(--ink);
  background: var(--surface-bright);
}
.head-input {
  font-weight: 700;
  background: var(--surface-2);
}
thead .head-input {
  background: var(--accent-soft);
}
.head-input:focus,
.cell:focus {
  outline: none;
  border-color: var(--accent);
}
.x {
  flex: none;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  opacity: 0.5;
}
.x:hover,
.x:focus-visible {
  opacity: 1;
  background: var(--bad-soft);
  color: var(--bad);
}
</style>
