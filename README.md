# Plapperlapapp – Vokabel-Spiele

A small, self-hosted web app for vocabulary practice in the classroom. Teachers build word lists, bundle them into an activity with one or more games, and share a link or QR code. Students open it in their browser and play - no account, no app to install.

## Games

🎲 **Eile mit Weile** · 🎈 **Ballon-Platzen** · 💥 **Kaboom** · 🃏 **Memory** · ✅ **Multiple Choice** · ⌨️ **Tippen** · 🚢 **Schiffe versenken** · 🤫 **Tabu**

Several of them also play across multiple devices at once - one student starts a room, the others join with a code or QR code, and everyone plays from their own phone.

## What it does

- **Works in five languages** - German, French, English, Italian and Spanish, for both the teacher's interface and the games themselves.
- **Spoken answers** - students can answer by talking instead of typing, checked by a local speech-recognition model. No audio is ever stored.
- **Whole textbooks in one list** - import from Excel, CSV, Quizlet or Anki exports, tag words by unit/chapter, and let students practise just the words from today's lesson.
- **Sharing between teachers** - word lists and activities can be shared with colleagues, with view or edit rights, without copying anything.
- **Conjugation tables** - a dedicated mode for verb tables (pronouns × verbs), usable by every game.
- **No accounts for students** - only teachers sign up; students just open a link.

## Try it locally

```sh
cd frontend
npm install
npm run dev
```

This starts the app in a self-contained **test mode** - no backend, no database, nothing to configure - with a demo teacher account and a ready-to-play activity. Open the link it prints and go to `/play/DEMO2345`.

## Documentation

- **[docs/technical.md](docs/technical.md)** - architecture, running the real backend, deployment (Docker Compose, Cloudflare Tunnel), the API, and how speech recognition and multiplayer rooms work under the hood.
- **[docs/contributing.md](docs/contributing.md)** - how to add a game, a multiplayer game, or a new language.

This project is open source under the [MIT License](LICENSE) - issues and pull requests are welcome.
