# TimeLogger

A Windows desktop app for tracking daily work and submitting it to Jira Tempo.

## Features

- Log time entries against Jira tickets with ticket search
- Import calendar meetings and turn them into time entries, including partial attendance and mid-meeting switches
- Lunch scheduling that fits around booked meetings
- Notes, automatically sorted into topics by a local Ollama model
- Daily Scrum tab summarising the previous working day and today, with blockers raised from notes and planned work picked from your assigned Jira tickets
- One-click submission to Tempo, with re-submission when entries change
- System tray access for quick task/note capture and submission

## UI development

All UI changes must follow [UI consistency rules](UI-CONSISTENCY.md), including shared page geometry, section spacing, component styling, responsive layouts, and scoped CSS review.

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

A release is made by pushing a tag. Nothing in the repository changes for it, so
pull requests never conflict over a version number.

```
git tag v0.9.0 && git push origin v0.9.0
```

The **Release** workflow then checks that the commit passed **Quality**, writes the
version from the tag into `src-tauri/tauri.conf.json`, `package.json` and
`src-tauri/Cargo.toml`, builds the installer and publishes a GitHub release with
generated notes. The version in those files is a `0.0.0` placeholder, so a build
that isn't from a tag reports `0.0.0`.

If a release already exists for the tag the workflow skips, so re-running is safe.
A tag is final: releases are immutable, so a bad release is fixed by tagging the
next version.

### Version numbers

- **Major change:** bump the middle number, such as `0.7.102` to `0.8.0`.
- **Minor change:** bump the last number, such as `0.8.0` to `0.8.1`.
- **`1.0.0`:** reserved for a release that's actually ready to use. The channel
  switch below must have shipped on `main` first, so that nobody moving from beta
  to main at 1.0 lands on a version without it.

### Release channels

| Tag | Tag it on | Release | Who gets it |
|---|---|---|---|
| `v0.8.0` | `main` | Normal | Everyone |
| `v0.9.0-beta.1` | `beta` | Pre-release | Anyone on the Beta channel |

The workflow refuses a beta tag that isn't on `beta`, and a full tag that isn't on
`main`.

To promote a tested beta, merge it into `main` and tag that commit with the full
version, such as `v0.9.0`. Then merge `main` back into `beta` with a merge commit,
so that the next promotion only contains new work.

Tags are the only way to publish, so protect `v*` tags in the repository rules to
stop anyone else creating one.

Each beta also updates `latest.json` on the `beta-manifest` branch, because GitHub
has no URL for the latest pre-release and this repository's releases are immutable.
The Release workflow needs that branch to exist, so don't delete it.

Keep database changes additive: add tables and columns, but don't rename, remove
or rewrite them. A beta and an older main build can both open the same database.

## Updates

Installed copies update themselves. On launch the app quietly asks GitHub for
the `latest.json` of its channel; if a newer version exists it offers to download
and install it, then restarts. Users can also trigger the check from
**Settings → About → Check for Updates**, and choose Main or Beta there.

Beta users are offered whichever of the two channels is newer. Moving from Beta to
Main never installs an older version: the app keeps its build until Main has a
newer one.

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
