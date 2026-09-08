import { test, expect } from '@playwright/test';
import { ROUTES, visit, pageHeading } from './helpers';

/**
 * The dashboard is the landing page, so a regression here is the first thing a
 * user sees. These assertions cover the four stat cards and the activity feed
 * added in v0.5.4 - the previous version of this file computed visibility flags
 * and then never asserted on them.
 */
test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await visit(page, ROUTES.dashboard);
  });

  test('shows all four stat cards', async ({ page }) => {
    for (const label of ["Today's Hours", 'This Week', 'Unsubmitted', 'Missed Days']) {
      await expect(page.locator('.stat-label', { hasText: label }).first()).toBeVisible();
    }
  });

  test('hour totals render as numbers, not placeholders', async ({ page }) => {
    const todayCard = page
      .locator('.stat-card')
      .filter({ hasText: "Today's Hours" })
      .first();

    /* Guards against the card silently rendering "NaN" or an empty string when
       the backend is unavailable, which is how it fails in practice. */
    await expect(todayCard.locator('.stat-value')).toHaveText(/^\d+(\.\d+)?h?$/);
  });

  test('the unsubmitted card links to the submit page', async ({ page }) => {
    const link = page.locator('a.stat-card-link').first();
    await expect(link).toHaveAttribute('href', '#/submit');

    await link.click();
    await expect(pageHeading(page)).toHaveText('Submit Time');
  });

  test('recent activity shows entries or an explicit empty state', async ({ page }) => {
    const items = page.locator('.activity-item');
    const empty = page.locator('.activity-empty');

    /* Exactly one of the two must be present - an activity panel that renders
       neither means the section failed to load. */
    const itemCount = await items.count();
    if (itemCount > 0) {
      expect(itemCount).toBeLessThanOrEqual(5);
      await expect(empty).toHaveCount(0);
    } else {
      await expect(empty).toBeVisible();
    }
  });

  test('the clock renders in 24-hour form', async ({ page }) => {
    const clock = page.locator('.current-time');
    await expect(clock).toBeVisible();
    /* en-GB, so no AM/PM suffix. */
    await expect(clock).not.toHaveText(/[AP]M/i);
  });
});
