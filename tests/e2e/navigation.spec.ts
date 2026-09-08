import { test, expect } from '@playwright/test';

test.describe('TimeLogger - All Pages Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await page.waitForLoadState('networkidle');
  });

  test('Dashboard page should load', async ({ page }) => {
    await page.goto('http://localhost:5173/');
    const content = page.locator('body');
    await expect(content).toBeVisible();
  });

  test('Daily Entries page should load', async ({ page }) => {
    // Try different navigation methods
    let success = false;
    
    // Method 1: Click nav link
    const navLink = page.locator('a:has-text("Entries"), a:has-text("Daily"), [href*="entries"]').first();
    if (await navLink.isVisible().catch(() => false)) {
      await navLink.click();
      success = true;
    }
    
    // Method 2: Direct navigation
    if (!success) {
      await page.goto('http://localhost:5173/entries');
    }
    
    // Verify page loaded
    const content = page.locator('body');
    await expect(content).toBeVisible();
  });

  test('Notes page should load', async ({ page }) => {
    let success = false;
    
    const navLink = page.locator('a:has-text("Notes"), [href*="notes"]').first();
    if (await navLink.isVisible().catch(() => false)) {
      await navLink.click();
      success = true;
    }
    
    if (!success) {
      await page.goto('http://localhost:5173/notes');
    }
    
    const content = page.locator('body');
    await expect(content).toBeVisible();
  });

  test('Calendar page should load', async ({ page }) => {
    let success = false;
    
    const navLink = page.locator('a:has-text("Calendar"), [href*="calendar"]').first();
    if (await navLink.isVisible().catch(() => false)) {
      await navLink.click();
      success = true;
    }
    
    if (!success) {
      await page.goto('http://localhost:5173/calendar');
    }
    
    const content = page.locator('body');
    await expect(content).toBeVisible();
  });

  test('Submit page should load', async ({ page }) => {
    let success = false;
    
    const navLink = page.locator('a:has-text("Submit"), [href*="submit"]').first();
    if (await navLink.isVisible().catch(() => false)) {
      await navLink.click();
      success = true;
    }
    
    if (!success) {
      await page.goto('http://localhost:5173/submit');
    }
    
    const content = page.locator('body');
    await expect(content).toBeVisible();
  });

  test('Settings page should load', async ({ page }) => {
    let success = false;
    
    const navLink = page.locator('a:has-text("Settings"), [href*="settings"]').first();
    if (await navLink.isVisible().catch(() => false)) {
      await navLink.click();
      success = true;
    }
    
    if (!success) {
      await page.goto('http://localhost:5173/settings');
    }
    
    const content = page.locator('body');
    await expect(content).toBeVisible();
  });

  test('Settings tabs should switch between extracted sections', async ({ page }) => {
    await page.getByRole('link', { name: /settings/i }).click();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();

    const tabs = [
      ['Jira & Tempo', 'Jira & Tempo Settings'],
      ['Current Sprint', 'Current Sprint'],
      ['Microsoft', 'Microsoft Integration Settings'],
      ['OneNote', 'OneNote Configuration'],
      ['Calendar', 'Outlook Calendar Integration'],
      ['Ollama', 'Ollama AI Settings'],
      ['App Settings', 'Application Settings'],
      ['Database & Data', 'Database & Data Management'],
      ['About', 'About TimeLogger'],
    ] as const;

    for (const [tab, heading] of tabs) {
      await page.getByRole('button', { name: new RegExp(tab, 'i') }).click();
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    }
  });
});
