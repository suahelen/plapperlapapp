import { useI18n } from 'vue-i18n'
import { t } from '@/i18n'
import type { GameDefinition } from './types'

/** A game's name in the current UI language (games/<id>/i18n/<lang>.json → name). */
export const gameName = (def: Pick<GameDefinition, 'id'>): string => t(`games.${def.id}.name`)

/** A game's one-line description in the current UI language. */
export const gameDescription = (def: Pick<GameDefinition, 'id'>): string => t(`games.${def.id}.description`)

/**
 * Translator scoped to one game's catalogue: gt('roll') → t('games.<id>.roll').
 * Pass a count as third argument for plural messages ("{n} Feld | {n} Felder").
 */
export function useGameT(id: string) {
  const { t } = useI18n()
  return (key: string, params: Record<string, unknown> = {}, plural?: number) =>
    plural === undefined ? t(`games.${id}.${key}`, params) : t(`games.${id}.${key}`, params, plural)
}
