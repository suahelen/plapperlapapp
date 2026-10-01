import { t } from '@/i18n'
import { gameName } from './i18n'
import type { GameDefinition, GameSettings, SettingField, SettingValue } from './types'

function isValid(field: SettingField, value: unknown): boolean {
  switch (field.type) {
    case 'boolean':
      return typeof value === 'boolean'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) && value >= field.min && value <= field.max
    case 'select':
      return field.options.some((o) => o.value === value)
    case 'multiselect':
      return (
        Array.isArray(value) &&
        value.length > 0 &&
        new Set(value).size === value.length &&
        value.every((v) => field.options.some((o) => o.value === v))
      )
  }
}

/**
 * Merges stored settings over the game's defaults. Each declared field is validated;
 * unknown keys are dropped and invalid values fall back to the default, so a game
 * always receives a complete, valid settings object.
 */
export function resolveSettings<S extends GameSettings>(def: GameDefinition<S>, stored: unknown): S {
  const input = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {}
  const out = { ...def.defaultSettings }
  for (const field of def.settingsFields) {
    let value = input[field.key]
    if (value === undefined && field.type === 'multiselect') value = field.migrate?.(input)
    if (value !== undefined && isValid(field, value)) {
      ;(out as GameSettings)[field.key] = value as SettingValue
    }
  }
  return out
}

/** Returns human-readable problems with the given settings (empty if valid). */
export function validateSettings(def: GameDefinition, stored: Record<string, unknown>): string[] {
  return def.settingsFields
    .filter((f) => stored[f.key] !== undefined && !isValid(f, stored[f.key]))
    .map((f) => t('settings.invalid', { game: gameName(def), setting: t(f.label) }))
}
