import { expect, type Page } from '@playwright/test';

/**
 * Shared helpers for the end-to-end suite.
 *
 * The app uses hash routing, so a plain `goto('/entries')` lands on the
 * dashboard instead of the entries page. Everything here goes through
 * `visit()` to keep that in one place.
 */

export const ROUTES = {
  dashboard: '#/',
  entries: '#/entries',
  notes: '#/notes',
  calendar: '#/calendar',
  submit: '#/submit',
  tempo: '#/tempo',
  settings: '#/settings',
} as const;

export const BACKEND_URL = 'http://localhost:3001';

/**
 * The heading of the current page.
 *
 * Scoped to the main landmark rather than the whole document so a heading
 * inside a dialog or notification cannot be mistaken for the page's own.
 */
export function pageHeading(page: Page) {
  return page.locator('main h1');
}

/** Navigate to a hash route and wait for the lazy-loaded view to render. */
export async function visit(page: Page, route: string) {
  await page.goto(route);
  await expect(pageHeading(page)).toBeVisible();
}

/**
 * Errors the SPA legitimately produces when run outside the Tauri shell.
 *
 * `transformCallback` comes from @tauri-apps/api trying to reach the native
 * bridge, and the connection failures are the backend sidecar, which is only
 * started by the shell. Neither indicates a broken page.
 */
const EXPECTED_OUTSIDE_TAURI = [
  'transformCallback',
  'ERR_CONNECTION_REFUSED',
  'Failed to fetch',
  'net::ERR_',
  '/api/execute',
];

export function isEnvironmentalError(text: string) {
  return EXPECTED_OUTSIDE_TAURI.some(fragment => text.includes(fragment));
}

/** Collect console errors that are not explained by running outside Tauri. */
export function collectRealConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (!isEnvironmentalError(text)) errors.push(text);
  });
  page.on('pageerror', error => {
    if (!isEnvironmentalError(error.message)) errors.push(error.message);
  });
  return errors;
}

/**
 * Whether the Node sidecar is reachable.
 *
 * It is started by the Tauri shell, not by this suite, so it is present when a
 * developer runs the app locally and absent on CI. Tests that need it skip
 * rather than fail, so its absence never turns the build red for the wrong
 * reason.
 */
export async function backendAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${BACKEND_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
