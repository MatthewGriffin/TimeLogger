# End-to-end tests

Playwright tests that drive the Vue app in a browser. They cover routing,
navigation, the settings panels and the dashboard, plus a set of contract tests
for the Node sidecar's tool API.

## Running them

```bash
npm run test:e2e
```

That is the whole setup. Playwright starts Vite itself, so nothing needs to be
running first.

| Command | Purpose |
| --- | --- |
| `npm run test:e2e` | Run the suite |
| `npm run test:e2e:ui` | Interactive runner |
| `npm run test:e2e:debug` | Step through with the inspector |
| `npm run test:e2e:report` | Open the last HTML report |
| `npx playwright test navigation.spec.ts` | One file |
| `npx playwright test -g "Settings tabs"` | Tests matching a name |

Browsers are installed with `npx playwright install chromium`.

## Files

| File | Covers |
| --- | --- |
| `helpers.ts` | Shared routes, the page-heading locator and the backend probe |
| `navigation.spec.ts` | Every route, the sidebar, browser history, all nine settings tabs |
| `dashboard.spec.ts` | The four stat cards, the unsubmitted link and recent activity |
| `backend-api.spec.ts` | The sidecar's tool API: create, read, duration, delete, submitted flag |

## Things that will catch you out

**The app uses hash routing.** `page.goto('/entries')` does not open the entries
page - it silently lands on the dashboard and the test passes having tested
nothing. This is what the whole suite used to do. Navigate with the constants in
`helpers.ts` (`ROUTES.entries` is `#/entries`).

**Each page has exactly one `<h1>`, and it belongs to the view.** The sidebar's
app name is a `<span>`, not a heading. `Document structure` in `navigation.spec.ts`
asserts this, so if you add a heading to a shared component those tests are what
will fail. Locate the page title with `pageHeading(page)`, which scopes to
`main h1` so a heading inside a dialog cannot be mistaken for it.

**Chromium only.** The app ships on WebView2, so Firefox and WebKit results would
say nothing about what users actually run.

**The backend tests need the sidecar, and it is not started here.** It is launched
by the Tauri shell, so it is present when you have the app open and absent in CI.
Those tests skip when it is unreachable rather than failing.

**The backend tests hit your real database.** There is no separate test database.
They write to `1999-01-04`, far outside any working range, and delete only the
entries they created. If you add one, follow the same pattern - an earlier version
of these tests wrote onto *today's* date and never cleaned up, which corrupted real
timesheets.

**`upsert_daily_summary` splits an entry around anything it overlaps.** Tests run in
parallel against that one date, so each owns a disjoint slice of the day. Reusing a
time range another test holds gives you a shorter segment than you asked for, and a
confusing failure. The current allocation is listed at the top of
`backend-api.spec.ts`.

## In CI

The suite runs in the `validate` job of `.github/workflows/quality.yml`, after
`npm run check`. There is no sidecar on the runner, so the expected result is
26 passed and 6 skipped. The report is uploaded as an artifact when a run fails.
