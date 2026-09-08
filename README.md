# TimeLogger

A Windows desktop app for tracking daily work and submitting it to Jira Tempo.

## Features

- Log time entries against Jira tickets with ticket search
- Import calendar meetings and turn them into time entries, including partial attendance and mid-meeting switches
- Lunch scheduling that fits around booked meetings
- Notes, automatically sorted into topics by a local Ollama model
- Daily Scrum tab summarising the previous working day and today, with blockers raised from notes
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

## Updates

Installed copies update themselves. On launch the app quietly asks GitHub for
the `latest.json` published with each release; if a newer version exists it
offers to download and install it, then restarts. Users can also trigger the
check from **Settings → About → Check for Updates**.

Each installer is signed with a minisign key at release time and the app
verifies that signature before installing, so a build that was not produced by
this pipeline is rejected. The key lives in two repository secrets:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

The matching public key is committed in `src-tauri/tauri.conf.json`.

> **Keep the private key backed up.** It cannot be recovered, and replacing it
> means every already-installed copy stops accepting updates and has to be
> reinstalled by hand.

Updating works from **0.4.0** onward, the first release to ship a signature and
a manifest. Earlier versions need a one-off manual install.

## License

MIT
