import type { Share } from '@/models'
import { request } from './client'

/** Word lists and activities are shared the same way (owner only). */
export type ShareTarget = 'vocabulary-sets' | 'activities'

export const listShares = (target: ShareTarget, id: string) => request<Share[]>('GET', `/${target}/${id}/shares`)

/** Shares with the teacher who has this email, or changes their role. */
export const putShare = (target: ShareTarget, id: string, email: string, role: Share['role']) =>
  request<Share>('POST', `/${target}/${id}/shares`, { email, role })

export const removeShare = (target: ShareTarget, id: string, userId: string) =>
  request<void>('DELETE', `/${target}/${id}/shares/${userId}`)
