import type { Component } from 'vue'

/** Normalised vocabulary entry supplied to every game. Games never own vocabulary. */
export interface VocabularyItem {
  id: string
  source: string
  target: string
  sourceLanguage?: string
  targetLanguage?: string
  metadata?: Record<string, unknown>
}

export type Direction = 'source-to-target' | 'target-to-source' | 'mixed'

/** Props every game component receives. */
export interface GameProps<S> {
  vocabulary: VocabularyItem[]
  settings: S
}

/**
 * Declarative description of one teacher-configurable setting. `label` and option labels
 * are message keys (e.g. "settings.direction.label" or "games.<id>.settings.boardSize").
 */
export type SettingField =
  | { key: string; label: string; type: 'select'; options: { value: string | number; label: string }[] }
  | { key: string; label: string; type: 'boolean' }
  | { key: string; label: string; type: 'number'; min: number; max: number; step?: number }
  | {
      key: string
      label: string
      type: 'multiselect'
      /** `note` explains a caveat to teachers (e.g. speech needs a running service). */
      options: { value: string; label: string; note?: () => string | null }[]
      /** Derives a value from older stored settings (e.g. a renamed key), used when the key is missing. */
      migrate?: (stored: Record<string, unknown>) => unknown
    }

export type SettingValue = string | number | boolean | string[]
export type GameSettings = Record<string, SettingValue>

export interface MultiplayerMode {
  minPlayers: number
  maxPlayers: number
  /** Receives the same GameProps; manages its room via useRoom(). */
  component: Component
}

/**
 * A game plugin. Its name and description are texts in its own catalogue,
 * games/<id>/i18n/<lang>.json (`name`, `description`), shown via gameName()/gameDescription().
 */
export interface GameDefinition<S extends GameSettings = GameSettings> {
  id: string
  /** Short visual marker shown on game tiles. */
  icon: string
  /** Accent colour for the game's tile. */
  color: string
  minWords?: number
  maxWords?: number
  /** Single-device game. Loaded lazily so each game is its own bundle chunk. */
  component?: Component
  /**
   * Multi-device mode: every player on their own screen, coordinated by a server-side
   * engine (backend/internal/rooms). Games with both modes let students choose.
   */
  multiplayer?: MultiplayerMode
  defaultSettings: S
  /** Drives the generic settings form in the activity editor and settings validation. */
  settingsFields: SettingField[]
}
