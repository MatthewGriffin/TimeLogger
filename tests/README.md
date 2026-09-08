# Playwright E2E Testing Setup

## 📋 Overview

This directory contains end-to-end tests for the TimeLogger application using Playwright.

### Test Coverage

- **dashboard.spec.ts** - Dashboard page rendering and navigation
- **navigation.spec.ts** - All 6 main pages load correctly
- **backend-integration.spec.ts** - Backend API connectivity and response handling
- **time-entry.spec.ts** - CRUD operations for time entries, data persistence

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Playwright browsers installed: `npx playwright install`
- Backend server running on port 3001
- Frontend dev server running on port 5173

### Run All Tests
```bash
npm run test:e2e
```

### Run Tests in Debug Mode
```bash
npm run test:e2e:debug
```

### Run Tests in UI Mode (Interactive)
```bash
npm run test:e2e:ui
```

### View Test Report
```bash
npm run test:e2e:report
```

## 📊 Test Results

Test results are generated in multiple formats:
- **HTML Report**: `tests/results/html/index.html`
- **JUnit XML**: `tests/results/junit.xml` (CI/CD integration)
- **JSON**: `tests/results/results.json` (Programmatic access)

## 🔧 Configuration

### playwright.config.ts
- **Test Directory**: `tests/e2e/**/*.spec.ts`
- **Web Server**: Automatically starts `npm run dev`
- **Base URL**: `http://localhost:5173`
- **Browsers**: Chromium, Firefox, WebKit
- **Retry**: 2x on CI, 0x locally
- **Screenshot**: On failure only
- **Video**: On failure only

### Environment Variables

- `CI=true` - Enable CI mode (retries, single worker)
- `DEBUG=pw:api` - Enable Playwright debugging

## 📝 Test Structure

Each test file follows this pattern:

```typescript
test.describe('Feature Group', () => {
  test.beforeEach(async ({ page }) => {
    // Setup before each test
  });

  test('specific scenario', async ({ page }) => {
    // Test implementation
    expect(result).toBe(expected);
  });
});
```

## 🐛 Debugging

### Run Single Test File
```bash
npx playwright test tests/e2e/dashboard.spec.ts
```

### Run Tests Matching Pattern
```bash
npx playwright test -g "Dashboard"
```

### Debug Mode (Interactive Inspector)
```bash
npx playwright test --debug
```

### View Browser Console
Tests automatically check for console errors and report them.

### Screenshots & Videos
On failure:
- Screenshot saved to `tests/results/...`
- Video saved to `tests/results/...`

## ✅ Test Categories

### 1. Page Loading Tests
Verify each page renders without errors
- Dashboard ✓
- Daily Entries ✓
- Notes ✓
- Calendar ✓
- Submit ✓
- Settings ✓

### 2. Navigation Tests
Verify navigation between pages works
- Sidebar links clickable
- Routes respond to direct navigation
- Page transitions smooth

### 3. Backend Integration Tests
Verify frontend connects to backend API
- Health check endpoint
- Tools API responds
- CORS configured correctly
- Network errors logged

### 4. CRUD Operation Tests
Verify time entry operations
- Create time entry ✓
- Read time entry ✓
- Update time entry (if implemented)
- Delete time entry (if implemented)
- Data persistence ✓
- Calculations accurate ✓

## 🎯 Expected Test Results

All tests should **PASS** when:
- ✅ Backend server running on port 3001
- ✅ Frontend dev server running on port 5173
- ✅ Database initialized with schema
- ✅ All API routes respond

## 📈 Continuous Integration

These tests are designed for CI/CD pipelines:

```yaml
# Example GitHub Actions workflow
- name: Run E2E Tests
  run: npm run test:e2e
  
- name: Upload Report
  if: always()
  uses: actions/upload-artifact@v3
  with:
    name: playwright-report
    path: tests/results/html/
```

## 🔍 Troubleshooting

### Tests timing out
- Ensure backend is running: `npm --prefix src-node start`
- Ensure frontend is running: `npm run dev`
- Check network connectivity

### Browser not launching
- Install browsers: `npx playwright install`
- Check disk space
- Try: `npx playwright install --force`

### Port already in use
- Backend: Change port in `src-node/server.js` (currently 3001)
- Frontend: Vite uses port 5173, auto-incrementing if in use

### No screenshots/videos
- Ensure tests are failing (screenshots only on failure by default)
- Change `screenshot` setting in `playwright.config.ts` to `'always'`

## 📚 Resources

- [Playwright Docs](https://playwright.dev)
- [Test Best Practices](https://playwright.dev/docs/best-practices)
- [Debugging Guides](https://playwright.dev/docs/debug)
- [API Reference](https://playwright.dev/docs/api/intro)

## 🏗️ Adding New Tests

1. Create new `.spec.ts` file in `tests/e2e/`
2. Import: `import { test, expect } from '@playwright/test'`
3. Write test suite with `test.describe()` and `test()`
4. Use `await page.goto()`, `page.locator()`, etc.
5. Run: `npm run test:e2e`

Example:
```typescript
import { test, expect } from '@playwright/test';

test('my new test', async ({ page }) => {
  await page.goto('http://localhost:5173/');
  const heading = page.locator('h1');
  await expect(heading).toBeVisible();
});
```

---

**Last Updated**: 2026-09-04  
**Playwright Version**: 1.62.1  
**Test Environment**: Node.js 18+
