import { beforeEach, describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import { listGames } from '@/games/registry'
import type { Activity, PublicActivity, User, VocabularySet } from '@/models'
import { mockRequest, resetMockDb } from './mock'
import { ApiError } from './client'

// Minimal in-memory localStorage for the Node test environment.
const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
} as Storage

beforeEach(() => resetMockDb())

describe('mock API (test mode)', () => {
  it('starts logged in with demo data and a playable public activity', async () => {
    expect((await mockRequest<User>('GET', '/auth/me')).email).toBe('demo@lehrer.ch')
    // English ×2 + French table, plus the colleague's textbook list shared with the demo teacher
    expect(await mockRequest<VocabularySet[]>('GET', '/vocabulary-sets')).toHaveLength(4)
    const pub = await mockRequest<PublicActivity>('GET', '/public/activities/demo2345')
    expect(pub.games.map((g) => g.type)).toContain('eile-mit-weile')
    expect(pub.vocabulary.length).toBe(18)
  })

  it('supports the teacher flow end to end', async () => {
    const set = await mockRequest<VocabularySet>('POST', '/vocabulary-sets', {
      title: 'Colours',
      items: [
        { source: 'red', target: 'rot' },
        { source: 'blue', target: 'blau' },
      ],
    })
    const updated = await mockRequest<VocabularySet>('PUT', `/vocabulary-sets/${set.id}`, {
      title: 'Colours',
      items: [{ id: set.items![0].id, source: 'red', target: 'rot' }, { source: 'green', target: 'grün' }],
    })
    expect(updated.items!.map((i) => i.source)).toEqual(['red', 'green'])
    expect(updated.items![0].id).toBe(set.items![0].id)

    const act = await mockRequest<Activity>('POST', '/activities', {
      title: 'Farben',
      published: true,
      vocabularySetIds: [set.id],
      games: [{ type: 'memory', settings: {} }],
    })
    const pub = await mockRequest<PublicActivity>('GET', `/public/activities/${act.publicId}`)
    expect(pub.vocabulary.map((v) => v.target)).toEqual(['rot', 'grün'])
  })

  it('accepts Vue reactive objects in request bodies (as the activity editor sends)', async () => {
    const sets = await mockRequest<VocabularySet[]>('GET', '/vocabulary-sets')
    const settings = reactive({ direction: 'source-to-target', sticks: 20 })
    const act = await mockRequest<Activity>('POST', '/activities', {
      title: 'Reaktiv',
      published: false,
      vocabularySetIds: [sets[0].id],
      games: [{ type: 'kaboom', settings }],
    })
    expect(act.games[0].settings).toEqual({ direction: 'source-to-target', sticks: 20 })
  })

  it('adds newly registered games to the demo activity in existing stored data', async () => {
    await mockRequest('GET', '/auth/me') // seeds storage
    const key = 'plapperlapapp-mock-db'
    const db = JSON.parse(localStorage.getItem(key)!)
    const demo = db.activities.find((a: Activity) => a.publicId === 'DEMO2345')
    demo.games = demo.games.filter((g: { type: string }) => g.type !== 'kaboom')
    localStorage.setItem(key, JSON.stringify(db))

    const pub = await mockRequest<PublicActivity>('GET', '/public/activities/DEMO2345')
    expect(pub.games.map((g) => g.type)).toEqual(expect.arrayContaining(listGames().map((g) => g.id)))
  })

  it('rejects invalid input without changing data', async () => {
    await expect(mockRequest('POST', '/vocabulary-sets', { title: ' ' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
    await expect(
      mockRequest('POST', '/activities', { title: 'x', vocabularySetIds: [], games: [{ type: 'memory' }] }),
    ).rejects.toBeInstanceOf(ApiError)
    // English ×2 + French table, plus the colleague's textbook list shared with the demo teacher
    expect(await mockRequest<VocabularySet[]>('GET', '/vocabulary-sets')).toHaveLength(4)
  })

  it('hides unpublished activities and honours logout', async () => {
    const acts = await mockRequest<Activity[]>('GET', '/activities')
    const draft = acts.find((a) => !a.published)!
    await expect(mockRequest('GET', `/public/activities/${draft.publicId}`)).rejects.toMatchObject({ status: 404 })

    await mockRequest('POST', '/auth/logout')
    await expect(mockRequest('GET', '/auth/me')).rejects.toMatchObject({ status: 401 })
    await mockRequest('POST', '/auth/login', { email: 'Test@Schule.ch', password: 'x' })
    expect((await mockRequest<User>('GET', '/auth/me')).email).toBe('test@schule.ch')
  })
})

describe('mock API: sharing between teachers', () => {
  const login = (email: string) => mockRequest('POST', '/auth/login', { email, password: 'x' })
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: ApiError) => e.code)

  it('follows the rights table: view, copy, edit, owner-only share/delete', async () => {
    await login('demo@lehrer.ch')
    const sets = await mockRequest<VocabularySet[]>('GET', '/vocabulary-sets')
    const shared = sets.find((s) => s.role !== 'owner')!
    expect([shared.role, shared.ownerEmail]).toEqual(['viewer', 'kollegin@schule.ch'])

    // Viewer: read and copy, no edits, no sharing, no deleting.
    const full = await mockRequest<VocabularySet>('GET', `/vocabulary-sets/${shared.id}`)
    expect(full.items!.length).toBeGreaterThan(0)
    expect(await code(mockRequest('PUT', `/vocabulary-sets/${shared.id}`, { title: 'x' }))).toBe('FORBIDDEN')
    expect(await code(mockRequest('DELETE', `/vocabulary-sets/${shared.id}`))).toBe('FORBIDDEN')
    expect(await code(mockRequest('GET', `/vocabulary-sets/${shared.id}/shares`))).toBe('FORBIDDEN')
    const copy = await mockRequest<VocabularySet>('POST', `/vocabulary-sets/${shared.id}/copy`, { suffix: ' (Kopie)' })
    expect([copy.role, copy.title.endsWith(' (Kopie)'), copy.items!.length]).toEqual(['owner', true, full.items!.length])

    // The owner upgrades the demo teacher to editor.
    await login('kollegin@schule.ch')
    expect(await code(mockRequest('POST', `/vocabulary-sets/${shared.id}/shares`, { email: 'nobody@x.ch', role: 'viewer' }))).toBe('USER_NOT_FOUND')
    expect(await code(mockRequest('POST', `/vocabulary-sets/${shared.id}/shares`, { email: 'kollegin@schule.ch', role: 'viewer' }))).toBe('CANNOT_SHARE_WITH_SELF')
    await mockRequest('POST', `/vocabulary-sets/${shared.id}/shares`, { email: 'demo@lehrer.ch', role: 'editor' })
    await login('demo@lehrer.ch')
    const edited = await mockRequest<VocabularySet>('PUT', `/vocabulary-sets/${shared.id}`, { ...full, title: 'Fixed' })
    expect([edited.title, edited.role]).toEqual(['Fixed', 'editor'])
    expect(await code(mockRequest('DELETE', `/vocabulary-sets/${shared.id}`))).toBe('FORBIDDEN')
  })

  it('uses a shared list by reference with a unit filter', async () => {
    await login('demo@lehrer.ch')
    const shared = (await mockRequest<VocabularySet[]>('GET', '/vocabulary-sets')).find((s) => s.role !== 'owner')!
    const fields = await mockRequest<Record<string, { value: string; count: number }[]>>('GET', `/vocabulary-sets/${shared.id}/fields`)
    expect(fields.Unit.map((v) => v.value)).toEqual(['1', '2', '3'])

    const a = await mockRequest<Activity>('POST', '/activities', {
      title: 'Unit 2',
      published: true,
      vocabularySets: [{ id: shared.id, filter: { Unit: ['2'] } }],
      games: [{ type: 'memory', settings: {} }],
    })
    const pub = await mockRequest<PublicActivity>('GET', `/public/activities/${a.publicId}`)
    expect(pub.vocabulary.map((v) => v.source)).toEqual(['le chien', 'le chat', "l'oiseau", 'le cheval'])

    // Revoking access removes nothing from the activity, but the owner's edits keep flowing in.
    await login('kollegin@schule.ch')
    const full = await mockRequest<VocabularySet>('GET', `/vocabulary-sets/${shared.id}`)
    await mockRequest('PUT', `/vocabulary-sets/${shared.id}`, {
      ...full,
      items: full.items!.map((i) => (i.source === 'le chien' ? { ...i, target: 'der Hund (m.)' } : i)),
    })
    const after = await mockRequest<PublicActivity>('GET', `/public/activities/${a.publicId}`)
    expect(after.vocabulary.find((v) => v.source === 'le chien')?.target).toBe('der Hund (m.)')
  })

  it('shares an activity together with its own lists', async () => {
    await login('demo@lehrer.ch')
    const demo = (await mockRequest<Activity[]>('GET', '/activities')).find((a) => a.publicId === 'DEMO2345')!
    await mockRequest('POST', `/activities/${demo.id}/shares`, { email: 'kollegin@schule.ch', role: 'viewer' })
    await login('kollegin@schule.ch')
    const seen = await mockRequest<Activity[]>('GET', '/activities')
    expect(seen.find((a) => a.id === demo.id)?.role).toBe('viewer')
    const lists = await mockRequest<VocabularySet[]>('GET', '/vocabulary-sets')
    expect(demo.vocabularySetIds.every((id) => lists.some((s) => s.id === id && s.role === 'viewer'))).toBe(true)
    const copy = await mockRequest<Activity>('POST', `/activities/${demo.id}/copy`, { suffix: ' (Kopie)' })
    expect([copy.role, copy.published, copy.vocabularySetIds]).toEqual(['owner', false, demo.vocabularySetIds])
  })
})
