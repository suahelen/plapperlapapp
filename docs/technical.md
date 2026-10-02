# Technical overview

```
Browser ─▶ Caddy ─┬─▶ static Vue app (frontend/dist)
                  └─▶ /api/* ─▶ Go API ─┬─▶ PostgreSQL (teachers, vocabulary, activities)
                                        ├─▶ in-memory game rooms (multiplayer)
                                        └─▶ ASR sidecar (Canary + Parakeet, spoken answers)
```

## Repository

| Path | Contents |
|---|---|
| `backend/` | Go API (chi, pgx, plain SQL). `cmd/server` has the `serve` and `migrate` subcommands. |
| `frontend/` | Vue 3 + TypeScript + Vite. Games live in `src/games/`. |
| `database/migrations/` | SQL migrations (golang-migrate format). |
| `asr/` | Local speech-to-text service (Python, Canary + Parakeet on CPU) for spoken answers. |
| `shared/` | Test cases both the Go and TypeScript answer checkers must pass. |
| `docker-compose.yml`, `Caddyfile` | Deployment. |

## Local development

### Test mode (frontend only)

```sh
cd frontend
npm install
npm run dev                    # http://localhost:5173
```

`npm run dev` runs in **test mode**, which needs no backend, no database and no login:

- The API is simulated in the browser (`src/api/mock.ts`, enabled by `.env.mock`).
- You start logged in as a demo teacher, with two word lists and a published demo activity with every game enabled: `/play/DEMO2345`.
- Changes are kept in the browser's localStorage.
- The 🧪 badge in the bottom-left corner links to every page and can reset the demo data.

Test mode is compiled out of production builds.

### With the real backend

Requirements: Go 1.25+, Node 20+, PostgreSQL 13+.

```sh
# 1. Database (once)
createuser -P vocab            # password: vocab
createdb -O vocab plapperlapapp

# 2. Backend
cd backend
cp ../.env.example ../.env     # adjust DATABASE_URL / SESSION_SECRET
export $(grep -v '^#' ../.env | xargs)   # or set the variables in your shell/IDE
go run ./cmd/server migrate up
go run ./cmd/server            # API on :8080

# 3. Frontend (second terminal)
cd frontend
npm install
npm run dev:api                # http://localhost:5173, proxies /api to :8080
```

PowerShell users can set variables with `$env:DATABASE_URL = "postgres://..."`.

**Note:** On Windows, PostgreSQL won't start from an elevated (administrator) shell. Use a normal user terminal or the installer's Windows service.

## Tests

```sh
cd frontend && npm test        # game logic, paste parser, settings
cd backend && go test ./...    # unit tests

# API integration tests (auth, authorization, CRUD, public endpoint) need a disposable DB:
createdb -O vocab plapperlapapp_test
TEST_DATABASE_URL=postgres://vocab:vocab@localhost:5432/plapperlapapp_test?sslmode=disable go test ./...
```

Integration tests skip when `TEST_DATABASE_URL` is unset. They truncate every table, so never point them at real data.

## Deployment (Docker Compose)

```sh
cp .env.example .env           # set POSTGRES_PASSWORD, SESSION_SECRET, SITE_ADDRESS (your domain)
docker compose up -d postgres
docker compose run --rm migrate   # apply migrations explicitly
docker compose up -d --build
```

With `SITE_ADDRESS=vocab.example.com`, Caddy obtains HTTPS certificates automatically. Keep `COOKIE_SECURE=true` whenever the site is served over HTTPS.

Migrations are never applied on startup. Run `migrate` deliberately after each update.

### Exposing it via Cloudflare Tunnel

If the server has no public IP, or you'd rather not open inbound ports at all, a `cloudflared` service is included under the `public` Compose profile:

```sh
docker compose --profile public up -d cloudflared
```

It reads `TUNNEL_TOKEN` from `.env` (create the tunnel in the Cloudflare Zero Trust dashboard, Networks → Tunnels; point its public hostname at the `web` service, e.g. `http://web:80`). Because Cloudflare terminates TLS at its edge, `SITE_ADDRESS=:80` is correct even in this setup - Caddy doesn't need its own certificate. Set `TRUST_PROXY=true` (already the default in Compose) so rate limiting keys off the real visitor IP (`CF-Connecting-IP`) rather than the tunnel's internal address.

### Moving to Supabase (or any managed PostgreSQL)

The app uses ordinary PostgreSQL only; it doesn't use Supabase Auth, Realtime or client libraries. To switch:

1. Point `DATABASE_URL` at the managed database, e.g. `...supabase.co:5432/postgres?sslmode=require`.
2. Run `server migrate up`.
3. Drop the `postgres` service from Compose.

## Languages

The whole interface is available in **German, French, English, Italian and Spanish**:

- **Teachers** pick their language with 🌐 in the header. It's remembered in the browser; the default is the browser's language, else German.
- **Games** appear in the **language being learned**: the word list's language that isn't German, so an «Englisch → Deutsch» list shows the games in English. The teacher can override it per activity («Sprache der Spiele»), which is stored in `activities.game_language` (migration `0002`).
- Teacher-typed language names («Englisch», «fr») are shown in the current UI language via `Intl.DisplayNames`. Players without a name appear as «Joueur 2» / «Player 2» / … in the game language; the server stores an empty name.

**How it works:** [vue-i18n](https://vue-i18n.intlify.dev/). App texts live in `frontend/src/i18n/locales/<lang>.json`; each game ships its own texts in `games/<id>/i18n/<lang>.json` (merged under `games.<id>`). German is bundled and is the fallback; the other languages load on first use. Server errors are translated by their error code (`errors.<CODE>`), so the Go API stays language-neutral.

See [docs/contributing.md](contributing.md#adding-a-language) for how to add one.

## Importing word lists

In the word-list editor, teachers can drop a file onto the *Wörter* card, click **📄 Datei importieren**, or use the drop zone that appears while a list is empty. Everything is read in the browser (`frontend/src/lib/importFile.ts`); the backend is unchanged.

| Format | Notes |
|---|---|
| CSV / TSV / TXT | Separator detected automatically (tab, `;` from German Excel, `,`, `|`); quoted cells; UTF-8, Windows-1252 (Excel on Windows) and UTF-16 («Unicode-Text») |
| Excel `.xlsx` | Every non-empty sheet; choose the sheet in the preview. The reader is loaded only when needed. |
| Quizlet export | Term/definition separated by tab (or another separator) |
| Anki export | `#separator:` / `#html:` headers respected; HTML formatting and `[sound:…]` removed |

Old `.xls`, `.ods`, Word and PDF files get a message asking to save as `.xlsx`/`.csv` (or to copy and paste the table).

**Preview:** a header row is recognised by language names («Englisch», «Deutsch», «fr», …) or words like «Wort», «Übersetzung», «Term», «Definition». Its languages pick the columns and fill empty language fields. The title is taken from the file name if empty. Incomplete rows and duplicates (also against the existing list) are skipped, and the teacher can append or replace. Files are capped at 5 MB and 2000 entries.

In *Konjugationstabelle* mode an imported file becomes the table (first row = verbs, first column = pronouns). Pasting also benefits: semicolon or comma separated text is recognised as well as cells copied from Excel.

### Whole textbooks: extra columns and choosing words by unit

Above every column of the preview the teacher picks what it holds: *Ausgangssprache*, *Zielsprache*, *Zusatzspalte* or *ignorieren*. Columns with textbook headers («Unit», «Lektion», «Seite», «Wortart», «Chapter», «Page», …) are pre-selected as extra columns. Extra values are saved with each word in `vocabulary_items.metadata.fields` (e.g. `{"Unit": "3", "Seite": "45"}`), so a whole textbook can be imported as one list.

- **Word list editor:** extra columns appear as editable columns. Teachers can filter by a value (e.g. Unit 3), sort by clicking a column header, and add or remove columns («＋»).
- **Activities:** each selected list with extra columns shows its values as chips («Unit: 1 2 3 …»). Picking values limits the activity to those words, with the count updating live («42 von 610 Wörtern»). It's stored as `activity_vocabulary_sets.filter` (`{"Unit": ["3","4"]}`: OR within a column, AND across columns; empty = all words) and applied when students load the activity or a multiplayer room.

## Sharing between teachers

Word lists and activities can be shared with colleagues by email («👥 Teilen» in the editor, owner only). Colleagues need an account on the same server.

| | Owner | Editor (*bearbeiten*) | Viewer (*ansehen*) |
|---|---|---|---|
| See, play, use a list in own activities | ✓ | ✓ | ✓ |
| Make a copy (own, independent version) | ✓ | ✓ | ✓ |
| Change words / the activity | ✓ | ✓ | – |
| Share, change rights, delete | ✓ | – | – |

- **Lists are referenced, not copied:** an activity can use any list you can see. When the owner fixes a word, every activity using the list gets the fix. Copying is only needed for your own diverging version.
- **Sharing an activity** also shares the lists it uses (that belong to the activity's owner) as *ansehen*, so it works for the colleague.
- If a list is deleted or access is revoked, it drops out of the activities using it. The owner sees how many colleagues' activities use a list.
- Viewers open lists and activities read-only, with «Kopie erstellen».
- **Implementation:**
  - All checks live in the stores, via `backend/internal/sharing`: a list or activity is visible if you own it or it's shared with you (tables `vocabulary_set_shares` and `activity_shares`, migration `0003`).
  - Unknown users never learn that a resource exists (404); viewers trying to edit get 403 `FORBIDDEN`.
  - Sharing is rate limited (30/min) because it reveals whether an email has an account.

In test mode you can log in as **kollegin@schule.ch** (any password) in a second window. She shares a textbook list with units with the demo teacher.

## Multiplayer games (several devices)

Students play on their own devices. One student starts a room and gets a code and QR code; the others scan it or type the code, entering their name. No accounts are needed.

| Game | Devices | Mode |
|---|---|---|
| Schiffe versenken | 2 | multi-device only (starts when both have joined) |
| Eile mit Weile | 2–4 | single device *or* multi-device |
| Kaboom | 2–6 | single device *or* multi-device |
| Memory | 2–4 | single device *or* multi-device |

For games with both modes, students pick *Auf diesem Gerät* or *Auf mehreren Geräten* when opening the game. In multi-device lobbies the room creator (host) starts the game once enough players have joined; late joins are refused. If a player's device drops out, the host can skip their turn so the others aren't stuck.

**How it works:**

- The Go API hosts **rooms** in memory (`backend/internal/rooms`), one engine per game (`rooms/battleship`, `rooms/eilemitweile`, `rooms/kaboom`, `rooms/memory`). The server rolls dice, draws sticks and shuffles cards, holds hidden state (ship positions, cup order, face-down cards), checks answers with the same rules as the browser (`internal/answer`, kept in sync by `shared/answer-cases.json`) and pushes each player their own view via **Server-Sent Events**. Moves are normal POST requests.
- Views never contain expected answers; in choice mode the browser builds the options from the vocabulary it already has.
- Players are identified by a random per-room token that is kept per browser tab, so a reload reconnects.
- Rooms aren't stored in the database. They expire after 2 hours without activity, and a server restart ends running games. At most 5000 rooms exist at once, and room creation and joining are rate limited per IP (generously, since a class shares one IP).
- This requires a **single API instance**. Scaling out would need shared room state, which isn't needed for classroom use.

**Conjugation tables:** the vocabulary editor has a *Konjugationstabelle* mode (verbs as columns, pronouns as rows; a table can be pasted from Excel). Each cell is saved as a normal entry, e.g. `nous (aller) → allons`, with `metadata.grid = {row, col}`. Every game can use such lists; Schiffe versenken turns the table into its board, so firing at *nous × aller* means typing *allons*. Ordinary word lists work too (each cell holds a word).

**Test mode:** `npm run dev` simulates rooms in the browser (`src/api/mockRooms.ts`). Each game has a TypeScript room engine (`src/games/<game>/roomEngine.ts`) that wraps the game's existing single-device rules (`logic.ts`). Open the game in several tabs to play against yourself. The demo activity `/play/DEMO2345` has all games; *Französisch – Konjugation* (`/play/FRANZ234`) has a ready-made table for Schiffe versenken.

See [docs/contributing.md](contributing.md#adding-a-multiplayer-game) for how to add a multiplayer game.

## Speech input (spoken answers)

In Eile mit Weile, Kaboom and Schiffe versenken, teachers choose in the game settings which answer modes are allowed: *Eintippen*, *Auswählen*, *Sprechen* (any combination). If more than one is allowed, students switch with the ⌨️ / 🔘 / 🎤 buttons above the answer field; the choice is remembered on the device.

Speaking: tap the microphone and speak (or hold it while speaking), and the student sees *Verstanden: «…»*. They then submit it or record again, so a misheard word never counts as a wrong answer. Answer checking ignores sentence punctuation (`Haus.` = `Haus`) and pronouns or articles the student adds in front (`vous allez` or `allez` for `allez`, `j'aime` for `aime`), in the browser and on the server alike. That matters for speech, because recognition is far more reliable on short phrases than on single words. Words the expected answer contains are still required: `Hund` is wrong for `der Hund`. The allowed words are in `shared/lead-words.json`.

**How it works:** the browser records a short clip, converts it to 16 kHz mono WAV and posts it to `/api/transcribe?language=de`. The Go API (`backend/internal/speech`) forwards it to the **ASR sidecar** in `asr/` (int8 ONNX via `onnx-asr`, CPU only). Audio is not stored anywhere.

**Language:** single short words are nearly impossible to assign to a language by sound alone ("Haus" vs. "house"). The browser therefore sends the expected answer's language, taken from the word list's *Ausgangssprache* / *Zielsprache*. Names like «Französisch», «English» or «fr» are mapped to ISO codes (`frontend/src/lib/languages.ts`), and the editor warns about names it doesn't recognise.

**Two models**, because neither does both jobs:

| | Model | Role |
|---|---|---|
| `ASR_MODEL` | `nemo-canary-1b-v2` | Is told the expected language, so it produces the answer text (native "Haus" → *Haus*, where Parakeet heard *House*). 25 European languages. |
| `ASR_GUARD_MODEL` | `nemo-parakeet-tdt-0.6b-v3` | Canary also **translates**: an English "the dog" with `language=de` comes back as *Der Hund*. Parakeet never translates. If it heard the question itself, and question and answer are clearly different words, the student is asked to say the translation instead (`games/shared/answer/spoken.ts`). Look-alike pairs (house/Haus) sound the same and are accepted. |

With `ASR_GUARD_MODEL=` (empty) the guard is off: faster, but reading the question aloud may count. With `ASR_MODEL=nemo-parakeet-tdt-0.6b-v3` alone, nothing translates, but the language is guessed (often wrong for single words).

- A clip takes about 0.8–1.1 s on a laptop CPU with both models (about 0.4 s for Canary alone). Loaded, both models together take roughly 1.5–2.5 GB of resident memory. Transcriptions run one at a time inside the sidecar; the Go API queues up to 2 concurrent requests and answers *busy* after waiting 10 s. A whole class speaking at once will queue, so for big groups plan on a server with more cores.
- **Idle unload:** the sidecar loads both models lazily on first use and unloads them again after `ASR_IDLE_UNLOAD_MINUTES` (default 15; `0` disables this) of no requests, freeing that memory back to the host. The next request after an unload just pays the ~20-30 s reload cost once - and, since that reload holds the sidecar's single processing lock, a second request arriving in that same window can hit the Go side's 10 s queue timeout and get a *busy* response. This only ever matters right after a cold start or a long idle gap, not during normal back-to-back use.
- Limits: WAV only, at most 512 KB (~15 s; the browser stops after 8 s), and rate limited per IP.
- Without `ASR_URL` (or if the sidecar is down), *Sprechen* is hidden for students and the teacher sees a note in the settings.

**Run it on the laptop** (Python 3.10+; with [uv](https://docs.astral.sh/uv/)):

```sh
cd asr
uv venv && uv pip install -r requirements.txt
.venv/Scripts/python server.py      # Linux/macOS: .venv/bin/python server.py
# first use downloads both models (~1.7 GB, cached in HF_HOME); listens on 127.0.0.1:8765
```

Then start the backend with `ASR_URL=http://127.0.0.1:8765`. In **test mode** (`npm run dev`) no backend is needed: Vite proxies `/asr` to the sidecar, so real speech works too. If the sidecar isn't running, *Sprechen* is simulated with a text field.

`ASR_THREADS` sets the CPU threads (default 4). More threads measured *slower* on a laptop, because they fight over cores.

**Microphone needs HTTPS.** Browsers only allow recording on `https://` or `localhost`. On the laptop itself it works. Student devices that open `http://<laptop-IP>` can't record, and see only the other modes. With a domain in `SITE_ADDRESS` (or behind a Cloudflare Tunnel), HTTPS is handled for you and speech works everywhere.

With Docker Compose the `asr` service runs alongside the API (internal only, model cached in the `asr_models` volume).

## Usage stats

`GET /api/stats` returns anonymous, aggregate counts - teacher accounts, total vocabulary words, and games played (overall and per game type). No user data is involved. The teacher-facing app and the `/stats` page both link to it; `/stats` itself needs no login, since there's nothing personal in the response.

`POST /api/stats/play {"gameType": "..."}` is called once by the frontend whenever a student actually starts a game (wired centrally in `PlayGamePage.vue`, so new games are covered automatically) - it's rate limited and only accepts ids present in `ValidGameTypes` (`backend/internal/stats/store.go`), which must be kept in sync with the frontend's game registry by hand.

## API

All endpoints are under `/api`. Errors use the shape `{"error": {"code", "message"}}`.

| Method | Path | Auth |
|---|---|---|
| POST | `/auth/register`, `/auth/login`, `/auth/logout` | – |
| GET | `/auth/me` | teacher |
| GET, POST | `/vocabulary-sets` | teacher |
| GET, PUT, DELETE | `/vocabulary-sets/{id}` (PUT syncs the items list) | teacher |
| POST | `/vocabulary-sets/{id}/items` (array) | teacher |
| POST | `/vocabulary-sets/{id}/copy` `{suffix?}`, `/activities/{id}/copy` | teacher (any access) |
| GET | `/vocabulary-sets/{id}/fields` → extra column values with counts | teacher (any access) |
| GET, POST | `/vocabulary-sets/{id}/shares`, `/activities/{id}/shares` (`{email, role}`) | owner |
| DELETE | `/vocabulary-sets/{id}/shares/{userId}`, `/activities/{id}/shares/{userId}` | owner |
| PUT, DELETE | `/vocabulary-items/{id}` | teacher |
| GET, POST | `/activities` | teacher |
| GET, PUT, DELETE | `/activities/{id}` | teacher |
| GET | `/public/activities/{publicId}` (published only) | – |
| POST | `/rooms` `{publicId, gameType, name?}` → `{code, token, seat}` | – |
| POST | `/rooms/{code}/join` `{name?}` → `{code, token, seat}` | – |
| POST | `/rooms/{code}/actions` (header `X-Room-Token`) | room token |
| GET | `/rooms/{code}/events?token=…` (Server-Sent Events) | room token |
| GET | `/speech/status` → `{available}` | – |
| POST | `/transcribe?language=de` (body `audio/wav`, 16 kHz mono) → `{text, heard?}` | – |
| GET | `/stats` → `{users, words, totalPlays, byGame}` | – |
| POST | `/stats/play` `{gameType}` | – |

## Security

- Passwords are hashed with bcrypt.
- Sessions use a random token in an HttpOnly, SameSite=Lax cookie, and the database stores only an HMAC of it.
- CSRF protection comes from Go's `http.CrossOriginProtection`.
- Login and registration are rate limited per IP.
- Every query is scoped to its owner.
- Request bodies are limited to 1 MB.
- Behind a reverse proxy or tunnel, set `TRUST_PROXY=true` so rate limiting uses the real visitor IP (`CF-Connecting-IP` when present, otherwise the rightmost `X-Forwarded-For` entry) instead of the proxy's own address.
