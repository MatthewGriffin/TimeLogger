import { test, expect } from '@playwright/test';
import { ROUTES, visit, pageHeading, collectRealConsoleErrors } from './helpers';

/**
 * Every route must render its own page. These assertions are deliberately tied
 * to the real heading of each view: the previous version of this suite used
 * non-hash URLs, so every test silently landed on the dashboard and passed
 * regardless of whether the target page worked.
 */
const PAGES = [
  { name: 'Dashboard', route: ROUTES.dashboard, heading: 'Dashboard' },
  { name: 'Daily Entries', route: ROUTES.entries, heading: 'Daily Entries' },
  { name: 'Notes', route: ROUTES.notes, heading: 'Notes' },
  { name: 'Calendar', route: ROUTES.calendar, heading: 'Calendar' },
  { name: 'Submit Time', route: ROUTES.submit, heading: 'Submit Time' },
  { name: 'Tempo Status', route: ROUTES.tempo, heading: 'Tempo Status' },
  { name: 'Settings', route: ROUTES.settings, heading: 'Settings' },
] as const;

test.describe('Routing', () => {
  for (const page_ of PAGES) {
    test(`${page_.name} renders at ${page_.route}`, async ({ page }) => {
      await page.goto(page_.route);
      await expect(pageHeading(page)).toHaveText(page_.heading);
    });
  }

  test('unknown routes fall back to the dashboard', async ({ page }) => {
    await page.goto('#/this-route-does-not-exist');
    await expect(pageHeading(page)).toHaveText('Dashboard');
  });
});

test.describe('Navigation sidebar', () => {
  const NAV_ITEMS = [
    { label: 'Dashboard', path: '/' },
    { label: 'Daily Entries', path: '/entries' },
    { label: 'Notes', path: '/notes' },
    { label: 'Calendar', path: '/calendar' },
    { label: 'Submit Time', path: '/submit' },
    { label: 'Tempo Status', path: '/tempo' },
    { label: 'Settings', path: '/settings' },
  ];

  test('shows a link for every page', async ({ page }) => {
    await visit(page, ROUTES.dashboard);
    for (const item of NAV_ITEMS) {
      await expect(page.locator(`nav a[aria-label="${item.label}"], nav a[href="#${item.path}"]`).first())
        .toBeVisible();
    }
  });

  test('clicking a link navigates and marks the link active', async ({ page }) => {
    await visit(page, ROUTES.dashboard);

    const notesLink = page.locator('nav a[href="#/notes"]').first();
    await notesLink.click();

    await expect(pageHeading(page)).toHaveText('Notes');
    await expect(page).toHaveURL(/#\/notes$/);
    await expect(notesLink).toHaveClass(/active/);
  });

  test('browser back returns to the previous page', async ({ page }) => {
    await visit(page, ROUTES.dashboard);
    await page.locator('nav a[href="#/calendar"]').first().click();
    await expect(pageHeading(page)).toHaveText('Calendar');

    await page.goBack();
    await expect(pageHeading(page)).toHaveText('Dashboard');
  });
});

test.describe('Settings tabs', () => {
  /* Each tab must mount its own panel, identified by that panel's heading. */
  const TABS = [
    { tab: 'Jira & Tempo', heading: 'Jira & Tempo Settings' },
    { tab: 'Current Sprint', heading: 'Current Sprint' },
    { tab: 'Microsoft', heading: 'Microsoft Integration Settings' },
    { tab: 'OneNote', heading: 'OneNote Configuration' },
    { tab: 'Calendar', heading: 'Outlook Calendar Integration' },
    { tab: 'Ollama', heading: 'Ollama AI Settings' },
    { tab: 'App Settings', heading: 'Application Settings' },
    { tab: 'Database & Data', heading: 'Database & Data Management' },
    { tab: 'About', heading: 'About TimeLogger' },
  ];

  for (const { tab, heading } of TABS) {
    test(`${tab} tab opens its panel`, async ({ page }) => {
      await visit(page, ROUTES.settings);

      const button = page.locator('.tab-button', { hasText: tab }).first();
      await button.click();

      await expect(button).toHaveClass(/active/);
      await expect(page.locator('h2', { hasText: heading }).first()).toBeVisible();
    });
  }
});

test.describe('Page health', () => {
  test('no unexpected console errors while visiting every page', async ({ page }) => {
    const errors = collectRealConsoleErrors(page);

    for (const page_ of PAGES) {
      await page.goto(page_.route);
      await expect(pageHeading(page)).toHaveText(page_.heading);
    }

    expect(errors, `Unexpected console errors:\n${errors.join('\n')}`).toEqual([]);
  });
});
