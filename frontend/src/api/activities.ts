import type { Activity, ActivityInput, PublicActivity } from '@/models'
import { request } from './client'

export const listActivities = () => request<Activity[]>('GET', '/activities')

export const getActivity = (id: string) => request<Activity>('GET', `/activities/${id}`)

export const createActivity = (input: ActivityInput) => request<Activity>('POST', '/activities', input)

export const updateActivity = (id: string, input: ActivityInput) =>
  request<Activity>('PUT', `/activities/${id}`, input)

export const deleteActivity = (id: string) => request<void>('DELETE', `/activities/${id}`)

export const getPublicActivity = (publicId: string) =>
  request<PublicActivity>('GET', `/public/activities/${encodeURIComponent(publicId)}`)

export const publicUrl = (publicId: string) => `${window.location.origin}/play/${publicId}`

/** Copies an activity you can see into your own account (unpublished, same word lists). */
export const copyActivity = (id: string, suffix: string) =>
  request<Activity>('POST', `/activities/${id}/copy`, { suffix })
