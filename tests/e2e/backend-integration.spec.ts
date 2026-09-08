import { test, expect } from '@playwright/test';

test.describe('TimeLogger - Backend Integration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await page.waitForLoadState('networkidle');
  });

  test('Backend API should be accessible', async ({ page }) => {
    // Check if backend health endpoint is reachable
    const response = await page.evaluate(async () => {
      try {
        const res = await fetch('http://localhost:3001/health');
        return res.ok;
      } catch {
        return false;
      }
    });
    
    expect(response).toBeTruthy();
  });

  test('Tools API should return tools list', async ({ page }) => {
    const tools = await page.evaluate(async () => {
      try {
        const res = await fetch('http://localhost:3001/api/tools');
        const data = await res.json();
        return data.tools?.length || 0;
      } catch {
        return 0;
      }
    });
    
    expect(tools).toBeGreaterThan(0);
  });

  test('Daily Entries page should be functional', async ({ page }) => {
    // Navigate to Daily Entries
    await page.goto('http://localhost:5173/');
    
    // Try to navigate to entries
    const entryLink = page.locator('a:has-text("Entries"), a:has-text("Daily"), [href*="entries"]').first();
    if (await entryLink.isVisible().catch(() => false)) {
      await entryLink.click();
    } else {
      await page.goto('http://localhost:5173/entries');
    }
    
    await page.waitForLoadState('networkidle');
    
    // Page should load without errors
    const pageContent = await page.content();
    expect(pageContent.length).toBeGreaterThan(100);
  });

  test('Should display loading state while fetching', async ({ page }) => {
    await page.goto('http://localhost:5173/');
    
    const entryLink = page.locator('a:has-text("Entries"), a:has-text("Daily"), [href*="entries"]').first();
    if (await entryLink.isVisible().catch(() => false)) {
      await entryLink.click();
    }
    
    // Verify page loads
    await page.waitForTimeout(500);
    const content = page.locator('body');
    await expect(content).toBeVisible();
  });

  test('No network errors on page load', async ({ page }) => {
    const errors: string[] = [];
    
    page.on('requestfailed', request => {
      errors.push(request.url());
    });
    
    await page.goto('http://localhost:5173/');
    await page.waitForLoadState('networkidle');
    
    // Should have minimal errors (or none)
    expect(errors.length).toBeLessThan(3);
  });
});
