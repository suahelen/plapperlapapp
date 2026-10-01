import type { User } from '@/models'
import { request } from './client'

export const me = () => request<User>('GET', '/auth/me')

export const login = (email: string, password: string) =>
  request<User>('POST', '/auth/login', { email, password })

export const register = (email: string, password: string) =>
  request<User>('POST', '/auth/register', { email, password })

export const logout = () => request<void>('POST', '/auth/logout')
