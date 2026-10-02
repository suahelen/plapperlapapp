# Contributing

See [docs/technical.md](technical.md) first for the repository layout and how to run
the project locally.

## Adding a game

1. Create `frontend/src/games/<id>/` containing:
   - `<Name>Game.vue`: receives `vocabulary: VocabularyItem[]` and `settings` as props. Keep all game state in the component.
   - `definition.ts`: a `GameDefinition` with id, icon, colour token, `defaultSettings` and `settingsFields`. The activity editor builds its settings form from `settingsFields`, and the same schema validates stored settings. Setting labels are message keys (e.g. `games.<id>.settings.rounds`).
   - `i18n/{de,fr,en,it,es}.json`: the game's texts, at least `name` and `description`. Components use `const gt = useGameT('<id>')` and `gt('roll')`. The catalogue tests fail if a key is missing in any language.
   - `logic.ts` + `logic.test.ts` (recommended): the rules as pure functions, with no display texts.
2. Register the game in `frontend/src/games/registry.ts`.
3. If it should count toward the usage stats on `/stats`, add its id to `ValidGameTypes` in `backend/internal/stats/store.go` (the endpoint rejects unknown game types, since it's unauthenticated).

No other backend or database change is needed; the API stores game types and settings as opaque JSON.

Reusable building blocks in `src/games/shared/`:

- `answer/`: `PromptCard` and `AnswerInput`, which offers the answer modes the teacher allowed (typing, choice, speech) and lets students switch between them. Add `answerModesField` to a game's settings and pass `:modes="settings.answerModes"`. New modalities are registered in `answer/modes.ts`.
- `ui/`: `GameShell` (header, back, restart), `ResultScreen` (stars, confetti), `QuizGame`.
- `wordQueue.ts`: word order without repeats, with missed words coming back.
- `random.ts`: shuffle and a seeded RNG for tests.
- `timing.ts`: cancellable delays for game sequences.

## Adding a multiplayer game

See [docs/technical.md](technical.md#multiplayer-games-several-devices) for how rooms work.

1. A Go engine implementing `rooms.Engine` (`New`, `Join`, `Apply`, `View`; `View` must hide other players' secrets). `rooms.Roster` handles lobby joins and the host start, `rooms.CheckSkip` the host skip, and `rooms.WordQueue`/`rooms.MakePrompt` pick words without leaking answers.
2. Register it in `backend/cmd/server/main.go`.
3. In the frontend definition add `multiplayer: { minPlayers, maxPlayers, component }` (omit `component` at the top level for multi-device-only games).
4. For test mode, a TypeScript room engine registered in `src/api/mockRooms.ts` (helpers in `src/games/shared/room/rules.ts`).

`src/games/shared/room/` provides `useRoom` (create/join, live view, send actions), `RoomLobby` (names, code, QR code, player list, start button), `RoomPlayers` (scoreboard with the host's skip button) and `roomPrompt.ts` (server prompts ↔ `PromptCard`/`AnswerInput`).

## Adding a language

1. Copy `de.json` (app and each game's) to the new code and translate.
2. Add the code to `SUPPORTED` / `LOCALE_NAMES` in `src/i18n/index.ts` and to `gameLanguages` in `backend/internal/activities/model.go`.

The French, English, Italian and Spanish texts were written for this project; a quick review by native-speaking teachers is recommended for any new language too.

**Guards:** `src/i18n/catalogs.test.ts` checks four things:
- every key the code uses exists in German;
- every language has exactly the German keys, with the same `{placeholders}` and plural forms;
- every message compiles;
- `no-literals.test.ts` fails on visible text in templates that doesn't come from a catalogue.

## Theme (colours)

All colours are defined in **`frontend/src/theme.css`**, in two layers:
- **Palette** (`--palette-*`, the only literal colours in the app).
- **Semantic tokens** that components use: `--surface`, `--good`, `--player-red`, `--board-field`, `--sea`, `--cup`, …

Code that can't use CSS variables (the QR code canvas) reads resolved values with `themeColor()` from `src/lib/theme.ts`. `src/theme.test.ts` fails if a colour literal appears anywhere else, or if a component uses an undefined `var(--…)`.

**Another theme** (e.g. dark or high contrast) only needs a block that redefines semantic tokens, with no component changes:

```css
[data-theme="dark"] { --bg: …; --surface: …; --ink: …; }
```

Game tiles get their own token too (`--game-<id>`, mapped from the palette in `:root`) - pick a palette colour not already used by another game.
