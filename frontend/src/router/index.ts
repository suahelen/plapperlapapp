import { createRouter, createWebHistory } from 'vue-router'
import { watch } from 'vue'
import { loadMe } from '@/stores/session'
import { teacherLocale } from '@/stores/locale'
import { setLocale } from '@/i18n'

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    guestOnly?: boolean
    play?: boolean
  }
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/activities' },
    { path: '/login', component: () => import('@/pages/LoginPage.vue'), meta: { guestOnly: true } },
    { path: '/register', component: () => import('@/pages/RegisterPage.vue'), meta: { guestOnly: true } },

    { path: '/vocabulary', component: () => import('@/pages/VocabularyListPage.vue'), meta: { requiresAuth: true } },
    { path: '/vocabulary/new', component: () => import('@/pages/VocabularyEditPage.vue'), meta: { requiresAuth: true } },
    {
      path: '/vocabulary/:id',
      component: () => import('@/pages/VocabularyEditPage.vue'),
      props: true,
      meta: { requiresAuth: true },
    },

    { path: '/stats', component: () => import('@/pages/StatsPage.vue') },

    { path: '/activities', component: () => import('@/pages/ActivityListPage.vue'), meta: { requiresAuth: true } },
    { path: '/activities/new', component: () => import('@/pages/ActivityEditPage.vue'), meta: { requiresAuth: true } },
    {
      path: '/activities/:id',
      component: () => import('@/pages/ActivityEditPage.vue'),
      props: true,
      meta: { requiresAuth: true },
    },

    { path: '/play/:publicId', component: () => import('@/pages/PlayHomePage.vue'), props: true, meta: { play: true } },
    {
      path: '/play/:publicId/:gameId',
      component: () => import('@/pages/PlayGamePage.vue'),
      props: true,
      meta: { play: true },
    },

    { path: '/:pathMatch(.*)*', component: () => import('@/pages/NotFoundPage.vue') },
  ],
})

router.beforeEach(async (to) => {
  if (!to.meta.requiresAuth && !to.meta.guestOnly) return true
  const user = await loadMe().catch(() => null)
  if (to.meta.requiresAuth && !user) return { path: '/login', query: { next: to.fullPath } }
  if (to.meta.guestOnly && user) return '/activities'
  return true
})

// Teacher pages use the teacher's chosen language; student pages switch to the activity's
// game language themselves once the activity is loaded (see stores/publicActivity.ts).
router.beforeResolve(async (to) => {
  if (!to.meta.play) await setLocale(teacherLocale.value)
})
watch(teacherLocale, (locale) => {
  if (!router.currentRoute.value.meta.play) void setLocale(locale)
})
