/**
 * In-browser stand-in for the Go API, used only by `npm run dev` (test mode).
 * Data lives in localStorage so it survives reloads. It mirrors the real API's
 * routes, response shapes and main rules – including several teachers and sharing –
 * closely enough to click through every page without a backend or database.
 *
 * Logging in with another email switches to (or creates) that teacher, so sharing can
 * be tried in two browser windows. A colleague, kollegin@schule.ch, shares a textbook
 * list with the demo teacher.
 */
import type { Activity, PublicActivity, Role, SetRef, Share, User, VocabularyEntry, VocabularySet } from '@/models'
import { getGame, listGames } from '@/games/registry'
import { fieldValues, matchesFilter } from '@/lib/wordFilter'
import { ApiError } from './client'

const DEMO_PUBLIC_ID = 'DEMO2345'
const FRENCH_DEMO_PUBLIC_ID = 'FRANZ234'
const DEMO_EMAIL = 'demo@lehrer.ch'
const COLLEAGUE_EMAIL = 'kollegin@schule.ch'

/**
 * Copies data the way a real HTTP round trip does (JSON). Unlike structuredClone,
 * this also works for Vue reactive proxies passed in request bodies.
 */
const viaJson = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)))

const STORAGE_KEY = 'plapperlapapp-mock-db'
const LATENCY_MS = 120

interface StoredSet {
  id: string
  ownerId: string
  title: string
  sourceLanguage: string
  targetLanguage: string
  createdAt: string
  updatedAt: string
  items: (VocabularyEntry & { id: string })[]
}

interface StoredActivity {
  id: string
  ownerId: string
  title: string
  publicId: string
  published: boolean
  gameLanguage: string
  vocabularySets: SetRef[]
  games: Activity['games']
  createdAt: string
  updatedAt: string
}

interface StoredShare {
  id: string // the shared list or activity
  userId: string
  role: Share['role']
  createdAt: string
}

interface Db {
  version: 2
  users: User[]
  currentUserId: string | null
  sets: StoredSet[]
  activities: StoredActivity[]
  setShares: StoredShare[]
  activityShares: StoredShare[]
}

const uuid = () => crypto.randomUUID()
const now = () => new Date().toISOString()

function publicId() {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => alphabet[b % alphabet.length]).join('')
}

const pair = (source: string, target: string, fields?: Record<string, string>) => ({
  id: uuid(),
  source,
  target,
  ...(fields ? { metadata: { fields } } : {}),
})

function seed(): Db {
  const t = now()
  const demo: User = { id: uuid(), email: DEMO_EMAIL, createdAt: t }
  const unit3: StoredSet = {
    id: uuid(),
    ownerId: demo.id,
    title: 'English Unit 3 – Animals',
    sourceLanguage: 'Englisch',
    targetLanguage: 'Deutsch',
    createdAt: t,
    updatedAt: t,
    items: [
      pair('dog', 'Hund'),
      pair('cat', 'Katze'),
      pair('bird', 'Vogel'),
      pair('horse', 'Pferd'),
      pair('cow', 'Kuh'),
      pair('mouse', 'Maus'),
      pair('rabbit', 'Kaninchen / Hase'),
      pair('sheep', 'Schaf'),
      pair('fish', 'Fisch'),
      pair('duck', 'Ente'),
    ],
  }
  const unit4: StoredSet = {
    id: uuid(),
    ownerId: demo.id,
    title: 'English Unit 4 – At home',
    sourceLanguage: 'Englisch',
    targetLanguage: 'Deutsch',
    createdAt: t,
    updatedAt: t,
    items: [
      pair('house', 'Haus'),
      pair('tree', 'Baum'),
      pair('kitchen', 'Küche'),
      pair('window', 'Fenster'),
      pair('door', 'Tür'),
      pair('table', 'Tisch'),
      pair('chair', 'Stuhl'),
      pair('bed', 'Bett'),
    ],
  }
  const activity = (title: string, pid: string, published: boolean, sets: StoredSet[], games: Activity['games']): StoredActivity => ({
    id: uuid(),
    ownerId: demo.id,
    title,
    publicId: pid,
    published,
    gameLanguage: '',
    vocabularySets: sets.map((s) => ({ id: s.id, filter: {} })),
    games,
    createdAt: t,
    updatedAt: t,
  })
  return {
    version: 2,
    users: [demo],
    currentUserId: demo.id,
    sets: [unit3, unit4],
    activities: [
      // games: filled with every registered game by withAllDemoGames()
      activity('Prüfungsvorbereitung Unit 3 + 4', DEMO_PUBLIC_ID, true, [unit3, unit4], []),
      activity('Tiere (Entwurf)', publicId(), false, [unit3], [{ type: 'memory', settings: { pairs: 6 } }]),
    ],
    setShares: [],
    activityShares: [],
  }
}

/** A French conjugation table (see src/lib/grid.ts) and an activity for Schiffe versenken. */
function frenchDemo(ownerId: string): { set: StoredSet; activity: StoredActivity } {
  const t = now()
  const pronouns = ['je', 'tu', 'il/elle', 'nous', 'vous', 'ils/elles']
  const verbs: Record<string, string[]> = {
    être: ['suis', 'es', 'est', 'sommes', 'êtes', 'sont'],
    avoir: ['ai', 'as', 'a', 'avons', 'avez', 'ont'],
    aller: ['vais', 'vas', 'va', 'allons', 'allez', 'vont'],
    faire: ['fais', 'fais', 'fait', 'faisons', 'faites', 'font'],
  }
  const set: StoredSet = {
    id: uuid(),
    ownerId,
    title: 'Présent: être, avoir, aller, faire',
    sourceLanguage: 'Französisch',
    targetLanguage: 'Französisch',
    createdAt: t,
    updatedAt: t,
    items: Object.entries(verbs).flatMap(([verb, forms]) =>
      pronouns.map((p, i) => ({
        id: uuid(),
        source: `${p} (${verb})`,
        target: forms[i],
        metadata: { grid: { row: p, col: verb } },
      })),
    ),
  }
  const activity: StoredActivity = {
    id: uuid(),
    ownerId,
    title: 'Französisch – Konjugation',
    publicId: FRENCH_DEMO_PUBLIC_ID,
    published: true,
    gameLanguage: '',
    vocabularySets: [{ id: set.id, filter: {} }],
    games: ['battleship', 'kaboom', 'multiple-choice', 'typing'].map((type) => ({ type, settings: {} })),
    createdAt: t,
    updatedAt: t,
  }
  return { set, activity }
}

/** A colleague with a textbook list (extra columns Unit and Seite), shared with the demo teacher. */
function colleagueDemo(db: Db) {
  const t = now()
  const colleague: User = { id: uuid(), email: COLLEAGUE_EMAIL, createdAt: t }
  const words: [string, string, string, string][] = [
    ['1', '8', 'la maison', 'das Haus'],
    ['1', '8', "l'école", 'die Schule'],
    ['1', '9', 'le livre', 'das Buch'],
    ['1', '9', 'la table', 'der Tisch'],
    ['2', '14', 'le chien', 'der Hund'],
    ['2', '14', 'le chat', 'die Katze'],
    ['2', '15', "l'oiseau", 'der Vogel'],
    ['2', '15', 'le cheval', 'das Pferd'],
    ['3', '22', 'manger', 'essen'],
    ['3', '22', 'boire', 'trinken'],
    ['3', '23', 'aller', 'gehen'],
    ['3', '23', 'venir', 'kommen'],
  ]
  const set: StoredSet = {
    id: uuid(),
    ownerId: colleague.id,
    title: 'Envol 7 – Vocabulaire (Auszug)',
    sourceLanguage: 'Französisch',
    targetLanguage: 'Deutsch',
    createdAt: t,
    updatedAt: t,
    items: words.map(([unit, page, fr, de]) => pair(fr, de, { Unit: unit, Seite: page })),
  }
  db.users.push(colleague)
  db.sets.push(set)
  const demo = db.users.find((u) => u.email === DEMO_EMAIL)
  if (demo) db.setShares.push({ id: set.id, userId: demo.id, role: 'viewer', createdAt: t })
}

/** Converts data stored by the single-teacher version of the mock. */
function migrate(raw: any): Db {
  if (raw?.version === 2) return raw as Db
  const user: User = raw.user
  return {
    version: 2,
    users: [user],
    currentUserId: raw.loggedIn ? user.id : null,
    sets: (raw.sets ?? []).map((s: any) => ({ ...s, ownerId: user.id })),
    activities: (raw.activities ?? []).map((a: any) => ({
      ...a,
      ownerId: user.id,
      vocabularySets: (a.vocabularySetIds ?? []).map((id: string) => ({ id, filter: {} })),
      vocabularySetIds: undefined,
    })),
    setShares: [],
    activityShares: [],
  }
}

/** Adds demo content introduced after the stored data was created. */
function withDemoContent(db: Db): Db {
  const demo = db.users.find((u) => u.email === DEMO_EMAIL) ?? db.users[0]
  if (!db.activities.some((a) => a.publicId === FRENCH_DEMO_PUBLIC_ID)) {
    const { set, activity } = frenchDemo(demo.id)
    db.sets.push(set)
    db.activities.push(activity)
  }
  if (!db.users.some((u) => u.email === COLLEAGUE_EMAIL)) colleagueDemo(db)
  return withAllDemoGames(db)
}

/**
 * The demo activity always offers every registered game, so newly added games
 * show up in test mode without resetting the stored data.
 */
function withAllDemoGames(db: Db): Db {
  const demo = db.activities.find((a) => a.publicId === DEMO_PUBLIC_ID)
  if (demo) {
    for (const game of listGames()) {
      if (!demo.games.some((g) => g.type === game.id)) demo.games.push({ type: game.id, settings: {} })
    }
    // Offer every answer mode (typing, choice, speech) unless the teacher chose otherwise.
    for (const g of demo.games) {
      const field = getGame(g.type)?.settingsFields.find((f) => f.key === 'answerModes')
      if (field?.type === 'multiselect' && g.settings.answerModes === undefined && g.settings.answerMode === undefined) {
        g.settings.answerModes = field.options.map((o) => o.value)
      }
    }
  }
  return db
}

function load(): Db {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return withDemoContent(migrate(JSON.parse(raw)))
  } catch {
    // Corrupt or unavailable storage: start fresh.
  }
  const db = withDemoContent(seed())
  save(db)
  return db
}

function save(db: Db) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
  } catch {
    // Storage may be unavailable (private mode); data then lasts until reload.
  }
}

/** Restores the demo data (used by the test-mode banner). */
export function resetMockDb() {
  localStorage.removeItem(STORAGE_KEY)
}

// --- helpers ------------------------------------------------------------------

const fail = (status: number, code: string, message: string): never => {
  throw new ApiError(status, code, message)
}
const invalid = (message: string) => fail(400, 'VALIDATION_ERROR', message)
const forbidden = () => fail(403, 'FORBIDDEN', "You don't have permission to do this.")
const setNotFound = () => fail(404, 'VOCABULARY_SET_NOT_FOUND', 'Vocabulary set was not found.')
const itemNotFound = () => fail(404, 'VOCABULARY_ITEM_NOT_FOUND', 'Vocabulary entry was not found.')
const activityNotFound = () => fail(404, 'ACTIVITY_NOT_FOUND', 'Activity was not found.')

function me(db: Db): User {
  return db.users.find((u) => u.id === db.currentUserId) ?? fail(401, 'UNAUTHENTICATED', 'Please log in.')
}

const emailOf = (db: Db, userId: string) => db.users.find((u) => u.id === userId)?.email ?? ''

function roleOf(owner: string, shares: StoredShare[], id: string, userId: string): Role | null {
  if (owner === userId) return 'owner'
  return shares.find((s) => s.id === id && s.userId === userId)?.role ?? null
}
const setRole = (db: Db, s: StoredSet, userId: string) => roleOf(s.ownerId, db.setShares, s.id, userId)
const activityRole = (db: Db, a: StoredActivity, userId: string) => roleOf(a.ownerId, db.activityShares, a.id, userId)

/** The list if the user may do what `allowed` says (404 if they can't see it, 403 if they can't do this). */
function findSet(db: Db, id: string, allowed: (r: Role) => boolean = () => true): StoredSet {
  const set = db.sets.find((s) => s.id === id) ?? setNotFound()
  const role = setRole(db, set, me(db).id) ?? setNotFound()
  if (!allowed(role)) forbidden()
  return set
}
function findActivity(db: Db, id: string, allowed: (r: Role) => boolean = () => true): StoredActivity {
  const a = db.activities.find((x) => x.id === id) ?? activityNotFound()
  const role = activityRole(db, a, me(db).id) ?? activityNotFound()
  if (!allowed(role)) forbidden()
  return a
}
const canEdit = (r: Role) => r !== 'viewer'
const isOwner = (r: Role) => r === 'owner'

function toSet(db: Db, s: StoredSet, withItems: boolean): VocabularySet {
  const { ownerId, ...rest } = s
  return {
    ...rest,
    role: setRole(db, s, me(db).id)!,
    ownerEmail: emailOf(db, ownerId),
    itemCount: s.items.length,
    items: withItems ? s.items : undefined,
    usedByOthers: withItems
      ? db.activities.filter((a) => a.ownerId !== ownerId && a.vocabularySets.some((r) => r.id === s.id)).length
      : undefined,
  }
}

function toActivity(db: Db, a: StoredActivity): Activity {
  const { ownerId, ...rest } = a
  return {
    ...rest,
    vocabularySetIds: a.vocabularySets.map((r) => r.id),
    role: activityRole(db, a, me(db).id)!,
    ownerEmail: emailOf(db, ownerId),
  }
}

function cleanItems(raw: unknown): VocabularyEntry[] {
  const items = Array.isArray(raw) ? raw : []
  return items.map((it: VocabularyEntry, i) => {
    const source = String(it.source ?? '').trim()
    const target = String(it.target ?? '').trim()
    if (!source || !target) invalid(`Row ${i + 1}: source and target must not be empty.`)
    return { id: it.id, source, target, metadata: it.metadata }
  })
}

function setFields(body: any) {
  const title = String(body?.title ?? '').trim()
  if (!title) invalid('Title must not be empty.')
  return {
    title,
    sourceLanguage: String(body?.sourceLanguage ?? '').trim(),
    targetLanguage: String(body?.targetLanguage ?? '').trim(),
  }
}

/** Validates an activity body; `current` are lists the activity already uses (an editor may keep them). */
function activityFields(db: Db, body: any, current: string[] = []) {
  const title = String(body?.title ?? '').trim()
  if (!title) invalid('Title must not be empty.')
  const refs: SetRef[] = Array.isArray(body?.vocabularySets)
    ? body.vocabularySets.map((r: any) => ({ id: String(r.id), filter: r.filter ?? {} }))
    : (body?.vocabularySetIds ?? []).map((id: string) => ({ id, filter: {} }))
  const unique = refs.filter((r, i) => refs.findIndex((x) => x.id === r.id) === i)
  if (unique.length === 0) invalid('Select at least one vocabulary set.')
  const userId = me(db).id
  const usable = (id: string) => {
    const s = db.sets.find((x) => x.id === id)
    return !!s && (current.includes(id) || setRole(db, s, userId) !== null)
  }
  if (!unique.every((r) => usable(r.id))) {
    fail(400, 'VOCABULARY_SET_NOT_FOUND', 'One of the selected vocabulary sets was not found.')
  }
  const games = Array.isArray(body?.games) ? body.games : []
  if (games.length === 0) invalid('Enable at least one game.')
  const gameLanguage = String(body?.gameLanguage ?? '').trim().toLowerCase()
  if (!['', 'de', 'fr', 'en', 'it', 'es'].includes(gameLanguage)) invalid('Unsupported game language.')
  return {
    title,
    published: !!body?.published,
    vocabularySets: unique,
    games: games.map((g: any) => ({ type: String(g.type), settings: g.settings ?? {} })),
    gameLanguage,
  }
}

function publicActivity(db: Db, id: string): PublicActivity {
  const a = db.activities.find((x) => x.publicId === id.toUpperCase() && x.published) ?? activityNotFound()
  const seen = new Set<string>()
  const vocabulary = a.vocabularySets
    .flatMap((ref) => {
      const s = db.sets.find((x) => x.id === ref.id)
      if (!s) return []
      return s.items
        .filter((i) => matchesFilter(i.metadata, ref.filter))
        .map((i) => ({ ...i, sourceLanguage: s.sourceLanguage, targetLanguage: s.targetLanguage }))
    })
    .filter((i) => {
      const key = `${i.source}\u0000${i.target}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  return { title: a.title, gameLanguage: a.gameLanguage ?? '', games: a.games, vocabulary }
}

/** Content for a simulated multiplayer room (see mockRooms.ts); mirrors activities.LoadForRoom. */
export function mockRoomContent(publicId: string, gameType: string) {
  const pub = publicActivity(load(), publicId)
  const game =
    pub.games.find((g) => g.type === gameType) ??
    fail(400, 'GAME_NOT_ENABLED', 'This game is not enabled for the activity.')
  return viaJson({ items: pub.vocabulary, settings: game.settings })
}

// --- sharing ----------------------------------------------------------------------

function listShares(db: Db, shares: StoredShare[], id: string): Share[] {
  return shares
    .filter((s) => s.id === id)
    .map((s) => ({ userId: s.userId, email: emailOf(db, s.userId), role: s.role, createdAt: s.createdAt }))
    .sort((a, b) => a.email.localeCompare(b.email))
}

function putShare(db: Db, shares: StoredShare[], id: string, body: any): Share {
  const role = body?.role
  if (role !== 'viewer' && role !== 'editor') invalid('Email and a role (viewer or editor) are required.')
  const email = String(body?.email ?? '').trim().toLowerCase()
  const user = db.users.find((u) => u.email.toLowerCase() === email) ??
    fail(404, 'USER_NOT_FOUND', 'There is no teacher account with this email address.')
  if (user.id === me(db).id) fail(400, 'CANNOT_SHARE_WITH_SELF', "You can't share with yourself.")
  const existing = shares.find((s) => s.id === id && s.userId === user.id)
  if (existing) existing.role = role
  else shares.push({ id, userId: user.id, role, createdAt: now() })
  return listShares(db, shares, id).find((s) => s.userId === user.id)!
}

function removeShare(shares: StoredShare[], id: string, userId: string): StoredShare[] {
  if (!shares.some((s) => s.id === id && s.userId === userId)) setNotFound()
  return shares.filter((s) => !(s.id === id && s.userId === userId))
}

const suffixOf = (body: any) => {
  const s = typeof body?.suffix === 'string' ? body.suffix : ' (2)'
  return s.length > 40 ? ' (2)' : s
}

// --- router -----------------------------------------------------------------------

type Handler = (db: Db, params: string[], body: any) => unknown

const routes: [string, RegExp, Handler][] = [
  ['POST', /^\/auth\/(login|register)$/, (db, _p, body) => {
    const email = String(body?.email ?? '').trim().toLowerCase()
    if (!email.includes('@')) invalid('Please enter a valid email address.')
    // Test mode: any password works; a new email creates a new teacher.
    let user = db.users.find((u) => u.email.toLowerCase() === email)
    if (!user) {
      user = { id: uuid(), email, createdAt: now() }
      db.users.push(user)
    }
    db.currentUserId = user.id
    return user
  }],
  ['POST', /^\/auth\/logout$/, (db) => {
    db.currentUserId = null
  }],
  ['GET', /^\/auth\/me$/, (db) => me(db)],

  ['GET', /^\/vocabulary-sets$/, (db) => {
    const userId = me(db).id
    return db.sets
      .filter((s) => setRole(db, s, userId) !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((s) => toSet(db, s, false))
  }],
  ['POST', /^\/vocabulary-sets$/, (db, _p, body) => {
    const t = now()
    const set: StoredSet = {
      id: uuid(),
      ownerId: me(db).id,
      ...setFields(body),
      items: cleanItems(body?.items).map((i) => ({ ...i, id: uuid() })),
      createdAt: t,
      updatedAt: t,
    }
    db.sets.push(set)
    return toSet(db, set, true)
  }],
  ['GET', /^\/vocabulary-sets\/([^/]+)$/, (db, [id]) => toSet(db, findSet(db, id), true)],
  ['PUT', /^\/vocabulary-sets\/([^/]+)$/, (db, [id], body) => {
    const set = findSet(db, id, canEdit)
    Object.assign(set, setFields(body), { updatedAt: now() })
    if (Array.isArray(body?.items)) {
      // Same sync semantics as the backend: known IDs are kept, others get new IDs.
      set.items = cleanItems(body.items).map((i) => ({
        ...i,
        id: i.id && set.items.some((x) => x.id === i.id) ? i.id : uuid(),
      }))
    }
    return toSet(db, set, true)
  }],
  ['DELETE', /^\/vocabulary-sets\/([^/]+)$/, (db, [id]) => {
    findSet(db, id, isOwner)
    db.sets = db.sets.filter((s) => s.id !== id)
    db.setShares = db.setShares.filter((s) => s.id !== id)
    db.activities.forEach((a) => (a.vocabularySets = a.vocabularySets.filter((r) => r.id !== id)))
  }],
  ['POST', /^\/vocabulary-sets\/([^/]+)\/copy$/, (db, [id], body) => {
    const src = findSet(db, id)
    const t = now()
    const copy: StoredSet = {
      ...viaJson(src),
      id: uuid(),
      ownerId: me(db).id,
      title: (src.title + suffixOf(body)).slice(0, 200),
      items: src.items.map((i) => ({ ...viaJson(i), id: uuid() })),
      createdAt: t,
      updatedAt: t,
    }
    db.sets.push(copy)
    return toSet(db, copy, true)
  }],
  ['GET', /^\/vocabulary-sets\/([^/]+)\/fields$/, (db, [id]) => fieldValues(findSet(db, id).items)],
  ['GET', /^\/vocabulary-sets\/([^/]+)\/shares$/, (db, [id]) => {
    findSet(db, id, isOwner)
    return listShares(db, db.setShares, id)
  }],
  ['POST', /^\/vocabulary-sets\/([^/]+)\/shares$/, (db, [id], body) => {
    findSet(db, id, isOwner)
    return putShare(db, db.setShares, id, body)
  }],
  ['DELETE', /^\/vocabulary-sets\/([^/]+)\/shares\/([^/]+)$/, (db, [id, userId]) => {
    findSet(db, id, isOwner)
    db.setShares = removeShare(db.setShares, id, userId)
  }],
  ['POST', /^\/vocabulary-sets\/([^/]+)\/items$/, (db, [id], body) => {
    const set = findSet(db, id, canEdit)
    set.items.push(...cleanItems(body).map((i) => ({ ...i, id: uuid() })))
    set.updatedAt = now()
    return set.items
  }],
  ['PUT', /^\/vocabulary-items\/([^/]+)$/, (db, [id], body) => {
    const owner = db.sets.find((s) => s.items.some((i) => i.id === id)) ?? itemNotFound()
    const set = findSet(db, owner.id, canEdit)
    const item = set.items.find((i) => i.id === id)!
    Object.assign(item, cleanItems([body])[0], { id })
    return item
  }],
  ['DELETE', /^\/vocabulary-items\/([^/]+)$/, (db, [id]) => {
    const owner = db.sets.find((s) => s.items.some((i) => i.id === id)) ?? itemNotFound()
    const set = findSet(db, owner.id, canEdit)
    set.items = set.items.filter((i) => i.id !== id)
  }],

  ['GET', /^\/activities$/, (db) => {
    const userId = me(db).id
    return db.activities
      .filter((a) => activityRole(db, a, userId) !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((a) => toActivity(db, a))
  }],
  ['POST', /^\/activities$/, (db, _p, body) => {
    const t = now()
    const a: StoredActivity = { id: uuid(), ownerId: me(db).id, publicId: publicId(), ...activityFields(db, body), createdAt: t, updatedAt: t }
    db.activities.push(a)
    return toActivity(db, a)
  }],
  ['GET', /^\/activities\/([^/]+)$/, (db, [id]) => toActivity(db, findActivity(db, id))],
  ['PUT', /^\/activities\/([^/]+)$/, (db, [id], body) => {
    const a = findActivity(db, id, canEdit)
    Object.assign(a, activityFields(db, body, a.vocabularySets.map((r) => r.id)), { updatedAt: now() })
    return toActivity(db, a)
  }],
  ['DELETE', /^\/activities\/([^/]+)$/, (db, [id]) => {
    findActivity(db, id, isOwner)
    db.activities = db.activities.filter((a) => a.id !== id)
    db.activityShares = db.activityShares.filter((s) => s.id !== id)
  }],
  ['POST', /^\/activities\/([^/]+)\/copy$/, (db, [id], body) => {
    const src = findActivity(db, id)
    const userId = me(db).id
    const t = now()
    const copy: StoredActivity = {
      ...viaJson(src),
      id: uuid(),
      ownerId: userId,
      publicId: publicId(),
      published: false,
      title: (src.title + suffixOf(body)).slice(0, 200),
      // Same lists by reference – those the user can see.
      vocabularySets: src.vocabularySets.filter((r) => {
        const s = db.sets.find((x) => x.id === r.id)
        return s && setRole(db, s, userId) !== null
      }),
      createdAt: t,
      updatedAt: t,
    }
    db.activities.push(copy)
    return toActivity(db, copy)
  }],
  ['GET', /^\/activities\/([^/]+)\/shares$/, (db, [id]) => {
    findActivity(db, id, isOwner)
    return listShares(db, db.activityShares, id)
  }],
  ['POST', /^\/activities\/([^/]+)\/shares$/, (db, [id], body) => {
    const a = findActivity(db, id, isOwner)
    const share = putShare(db, db.activityShares, id, body)
    // Sharing an activity also gives the colleague (at least) view access to its own lists.
    for (const ref of a.vocabularySets) {
      const s = db.sets.find((x) => x.id === ref.id)
      if (s && s.ownerId === a.ownerId && !db.setShares.some((x) => x.id === s.id && x.userId === share.userId)) {
        db.setShares.push({ id: s.id, userId: share.userId, role: 'viewer', createdAt: now() })
      }
    }
    return share
  }],
  ['DELETE', /^\/activities\/([^/]+)\/shares\/([^/]+)$/, (db, [id, userId]) => {
    findActivity(db, id, isOwner)
    db.activityShares = removeShare(db.activityShares, id, userId)
  }],

  ['GET', /^\/public\/activities\/([^/]+)$/, (db, [id]) => publicActivity(db, decodeURIComponent(id))],

  // Lightweight, anonymous usage stats: no-op in test mode, just a plausible read-out.
  ['POST', /^\/stats\/play$/, () => undefined],
  [
    'GET',
    /^\/stats$/,
    (db) => ({
      users: db.users.length,
      words: db.sets.reduce((sum, s) => sum + s.items.length, 0),
      totalPlays: 0,
      byGame: {},
    }),
  ],
]

export async function mockRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  await new Promise((r) => setTimeout(r, LATENCY_MS))
  const db = load()
  for (const [m, pattern, handler] of routes) {
    const match = m === method && pattern.exec(path)
    if (!match) continue
    // Work on a copy so a failed request leaves the stored data unchanged.
    const draft: Db = viaJson(db)
    const result = handler(draft, match.slice(1), viaJson(body))
    save(draft)
    return viaJson(result) as T
  }
  return fail(404, 'NOT_FOUND', 'Endpoint was not found.')
}
