import { ref } from 'vue'
import * as authApi from '@/api/auth'
import { ApiError } from '@/api/client'
import type { User } from '@/models'

// Minimal shared session state. A store library isn't needed for a single value.
export const currentUser = ref<User | null>(null)
let loaded: Promise<User | null> | null = null

/** Loads the current user once; later calls reuse the result. */
export function loadMe(): Promise<User | null> {
  loaded ??= authApi
    .me()
    .then((u) => (currentUser.value = u))
    .catch((e) => {
      if (e instanceof ApiError && e.status === 401) return (currentUser.value = null)
      loaded = null
      throw e
    })
  return loaded
}

export async function login(email: string, password: string) {
  currentUser.value = await authApi.login(email, password)
  loaded = Promise.resolve(currentUser.value)
}

export async function register(email: string, password: string) {
  currentUser.value = await authApi.register(email, password)
  loaded = Promise.resolve(currentUser.value)
}

export async function logout() {
  await authApi.logout()
  currentUser.value = null
  loaded = Promise.resolve(null)
}
