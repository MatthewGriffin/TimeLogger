# TimeLogger

A Windows desktop app for tracking daily work and submitting it to Jira Tempo.

## Features

- Log time entries against Jira tickets with ticket search
- Import calendar meetings and turn them into time entries, including partial attendance and mid-meeting switches
- Lunch scheduling that fits around booked meetings
- Notes, automatically sorted into topics by a local Ollama model
- One-click submission to Tempo, with re-submission when entries change
- System tray access for quick task/note capture and submission

## Tech stack

| Layer | Technology |
| --- | --- |
| Shell | Tauri 2 (Rust) |
| Frontend | Vue 3, TypeScript, Pinia, Vite |
| Backend | Node.js ESM sidecar (`src-node`) with better-sqlite3 |
| Integrations | Jira / Tempo REST APIs, Microsoft Graph, Ollama |

## Getting started

Requires Node.js 22 (see `.nvmrc`) and a Rust toolchain.

```bash
npm ci
npm ci --prefix src-node
npm run tauri dev
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server (frontend only) |
| `npm run build` | Type-check and build the frontend |
| `npm run test:backend` | Run the Node backend test suite |
| `npm run check` | Full local gate: version, build, tests, `cargo check` |
| `npm run tauri build` | Produce the NSIS installer |

## Releasing

Releases are automated. Every pull request into `main` is a new app version.

1. **Bump the version in your pull request.** It must be increased, and all
   three declarations must agree:
   - `src-tauri/tauri.conf.json` (the canonical source)
   - `package.json`
   - `src-tauri/Cargo.toml`

   The **Version** workflow blocks the pull request until this is done. Run
   `npm run check:version` locally to verify.

2. **Merge.** Once the **Quality** workflow passes on `main`, the **Release**
   workflow builds the installer and publishes a GitHub release tagged
   `v{version}` with generated release notes.

If a version has already been released the release workflow skips rather than
failing, so re-runs are safe.

## License

MIT
