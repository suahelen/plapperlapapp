import { getPublicActivity } from '@/api/activities'
import type { PublicActivity } from '@/models'
import { setLocale } from '@/i18n'
import { gameLocale } from '@/i18n/gameLocale'

// The activity is fetched once per visit and reused when switching between games.
const cache = new Map<string, Promise<PublicActivity>>()

function fetchCached(publicId: string): Promise<PublicActivity> {
  const key = publicId.toUpperCase()
  let p = cache.get(key)
  if (!p) {
    p = getPublicActivity(key)
    p.catch(() => cache.delete(key))
    cache.set(key, p)
  }
  return p
}

/** Loads the activity and switches the UI to its game language before resolving. */
export async function loadPublicActivity(publicId: string): Promise<PublicActivity> {
  const activity = await fetchCached(publicId)
  await setLocale(gameLocale(activity))
  return activity
}
