export interface User {
  id: string
  email: string
  createdAt: string
}

export interface VocabularyEntry {
  id?: string
  source: string
  target: string
  metadata?: Record<string, unknown>
}

export interface VocabularySet {
  id: string
  title: string
  sourceLanguage: string
  targetLanguage: string
  itemCount: number
  /** The requesting teacher's role: owner, editor or viewer. */
  role: Role
  ownerEmail: string
  /** Activities of other teachers that use this list (only on GET of one list). */
  usedByOthers?: number
  createdAt: string
  updatedAt: string
  items?: VocabularyEntry[]
}

export interface VocabularySetInput {
  title: string
  sourceLanguage: string
  targetLanguage: string
  items: VocabularyEntry[]
}

export interface ActivityGame {
  type: string
  settings: Record<string, unknown>
}

export interface Activity {
  id: string
  title: string
  publicId: string
  published: boolean
  vocabularySetIds: string[]
  /** The lists with the word filter per list. */
  vocabularySets: SetRef[]
  games: ActivityGame[]
  /** Language the games are shown in (de, fr, en, it, es); empty = automatic. */
  gameLanguage: string
  role: Role
  ownerEmail: string
  createdAt: string
  updatedAt: string
}

export interface ActivityInput {
  title: string
  published: boolean
  vocabularySets: SetRef[]
  games: ActivityGame[]
  gameLanguage?: string
}

export interface PublicVocabularyItem {
  id: string
  source: string
  target: string
  sourceLanguage?: string
  targetLanguage?: string
  metadata?: Record<string, unknown>
}

export interface PublicActivity {
  title: string
  gameLanguage?: string
  games: ActivityGame[]
  vocabulary: PublicVocabularyItem[]
}

/** A teacher's access to a shared list or activity. */
export type Role = 'owner' | 'editor' | 'viewer'

/**
 * Words of a list chosen by extra column values (metadata.fields):
 * {"Unit": ["3", "4"]} keeps words of Unit 3 or 4. Empty = all words.
 */
export type WordFilter = Record<string, string[]>

export interface SetRef {
  id: string
  filter: WordFilter
}

export interface Share {
  userId: string
  email: string
  role: Exclude<Role, 'owner'>
  createdAt: string
}

/** Extra column values of a list with how many words have them. */
export type FieldValues = Record<string, { value: string; count: number }[]>
