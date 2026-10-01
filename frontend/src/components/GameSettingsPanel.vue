<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { GameDefinition, GameSettings, SettingValue } from '@/games/types'

// Generic settings form rendered from a game's declarative `settingsFields`.
const props = defineProps<{ game: GameDefinition; modelValue: GameSettings }>()
const emit = defineEmits<{ 'update:modelValue': [GameSettings] }>()
const { t, te } = useI18n()
// Labels are message keys; plain values (e.g. "3") are shown as they are.
const label = (key: string) => (te(key) ? t(key) : key)

function set(key: string, value: SettingValue) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

function selected(key: string): string[] {
  const v = props.modelValue[key]
  return Array.isArray(v) ? v : []
}

// Keeps the options' order and never leaves the selection empty (the last box is disabled).
function toggle(key: string, value: string, on: boolean, options: { value: string }[]) {
  const next = new Set(selected(key))
  if (on) next.add(value)
  else next.delete(value)
  if (next.size > 0) set(key, options.map((o) => o.value).filter((v) => next.has(v)))
}

function onSelect(key: string, raw: string, options: { value: string | number }[]) {
  // Select values arrive as strings; map back to the typed option value.
  const match = options.find((o) => String(o.value) === raw)
  if (match) set(key, match.value)
}
</script>

<template>
  <div class="settings">
    <template v-for="field in game.settingsFields" :key="field.key">
      <label v-if="field.type === 'boolean'" class="check">
        <input
          type="checkbox"
          :checked="!!modelValue[field.key]"
          @change="set(field.key, ($event.target as HTMLInputElement).checked)"
        />
        {{ label(field.label) }}
      </label>

      <fieldset v-else-if="field.type === 'multiselect'" class="field multi">
        <legend>{{ label(field.label) }}</legend>
        <template v-for="o in field.options" :key="o.value">
          <label class="check">
            <input
              type="checkbox"
              :checked="selected(field.key).includes(o.value)"
              :disabled="selected(field.key).length === 1 && selected(field.key).includes(o.value)"
              @change="toggle(field.key, o.value, ($event.target as HTMLInputElement).checked, field.options)"
            />
            {{ label(o.label) }}
          </label>
          <small v-if="o.note && selected(field.key).includes(o.value) && o.note()" class="note">{{ o.note() }}</small>
        </template>
      </fieldset>

      <div v-else class="field">
        <label :for="`${game.id}-${field.key}`">{{ label(field.label) }}</label>
        <select
          v-if="field.type === 'select'"
          :id="`${game.id}-${field.key}`"
          :value="String(modelValue[field.key])"
          @change="onSelect(field.key, ($event.target as HTMLSelectElement).value, field.options)"
        >
          <option v-for="o in field.options" :key="String(o.value)" :value="String(o.value)">{{ label(o.label) }}</option>
        </select>
        <input
          v-else
          :id="`${game.id}-${field.key}`"
          class="input"
          type="number"
          :min="field.min"
          :max="field.max"
          :step="field.step ?? 1"
          :value="modelValue[field.key]"
          @change="set(field.key, Number(($event.target as HTMLInputElement).value))"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.settings {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px 16px;
  align-items: end;
}
.check {
  min-height: 44px;
}
.multi {
  border: 0;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-self: start;
}
.multi legend {
  padding: 0;
  margin-bottom: 4px;
  font-weight: 600;
}
.multi .check {
  min-height: 36px;
}
.note {
  color: var(--muted);
  margin: -4px 0 4px 26px;
  line-height: 1.3;
}
</style>
