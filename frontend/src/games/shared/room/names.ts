import { t } from '@/i18n'

/**
 * A player's display name. Players who didn't enter a name get "Spieler 2" /
 * "Joueur 2" / … in the current UI language (the server stores an empty name).
 */
export function playerName(name: string | undefined, seat: number): string {
  return name?.trim() ? name : t('room.player', { n: seat + 1 })
}
