import type { FieldValues, VocabularySet, VocabularySetInput } from '@/models'
import { request } from './client'

export const listSets = () => request<VocabularySet[]>('GET', '/vocabulary-sets')

export const getSet = (id: string) => request<VocabularySet>('GET', `/vocabulary-sets/${id}`)

export const createSet = (input: VocabularySetInput) => request<VocabularySet>('POST', '/vocabulary-sets', input)

/** Saves the set and synchronises its items to match `input.items`. */
export const updateSet = (id: string, input: VocabularySetInput) =>
  request<VocabularySet>('PUT', `/vocabulary-sets/${id}`, input)

export const deleteSet = (id: string) => request<void>('DELETE', `/vocabulary-sets/${id}`)

/** Copies a list you can see into your own account; `suffix` is appended to the title. */
export const copySet = (id: string, suffix: string) =>
  request<VocabularySet>('POST', `/vocabulary-sets/${id}/copy`, { suffix })

/** Extra columns (unit, page, …) of a list with their values and counts. */
export const getSetFields = (id: string) => request<FieldValues>('GET', `/vocabulary-sets/${id}/fields`)
