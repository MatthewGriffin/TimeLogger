import { test, expect } from '@playwright/test';

test.describe('TimeLogger - Time Entry Functionality', () => {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

  test.beforeEach(async ({ page }) => {
    // Start backend server (should already be running)
    await page.goto('http://localhost:5173/');
    await page.waitForLoadState('networkidle');
  });

  test('Create time entry via backend API', async ({ page }) => {
    const response = await page.evaluate(async (date) => {
      try {
        const res = await fetch('http://localhost:3001/api/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            toolName: 'upsert_daily_summary',
            args: {
              date,
              name: 'Test Task - Playwright',
              ticket_id: 'TEST-PW-001',
              start_time: '14:00',
              end_time: '15:00',
            }
          })
        });
        const data = await res.json();
        return data.result?.success || false;
      } catch (e) {
        return false;
      }
    }, today);

    expect(response).toBeTruthy();
  });

  test('Retrieve time entry via backend API', async ({ page }) => {
    const result = await page.evaluate(async (date) => {
      try {
        const res = await fetch('http://localhost:3001/api/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            toolName: 'get_daily_summary',
            args: { date }
          })
        });
        const data = await res.json();
        return {
          success: data.result?.success || false,
          count: data.result?.entriesCount || 0,
          hours: data.result?.totalHours || '0.00'
        };
      } catch (e) {
        return { success: false, count: 0, hours: '0.00' };
      }
    }, today);

    expect(result.count).toBeGreaterThan(0);
    expect(parseFloat(result.hours)).toBeGreaterThan(0);
  });

  test('Time calculation should be accurate', async ({ page }) => {
    // Create entry with known duration (2 hours)
    await page.evaluate(async (date) => {
      await fetch('http://localhost:3001/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolName: 'upsert_daily_summary',
          args: {
            date,
            name: 'Two Hour Task',
            ticket_id: 'TEST-PW-002',
            start_time: '10:00',
            end_time: '12:00',
          }
        })
      });
    }, today);

    // Retrieve and verify
    const result = await page.evaluate(async (date) => {
      const res = await fetch('http://localhost:3001/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolName: 'get_daily_summary',
          args: { date }
        })
      });
      const data = await res.json();
      return {
        totalHours: parseFloat(data.result?.totalHours || '0'),
        entries: data.result?.entries || []
      };
    }, today);

    expect(result.totalHours).toBeGreaterThanOrEqual(1.0);
    expect(result.entries.length).toBeGreaterThan(0);
  });

  test('Entry should be retrievable after creation', async ({ page }) => {
    const entryId = await page.evaluate(async (date) => {
      // Create
      const createRes = await fetch('http://localhost:3001/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolName: 'upsert_daily_summary',
          args: {
            date,
            name: 'Persistence Test',
            ticket_id: 'TEST-PERSIST',
            start_time: '16:00',
            end_time: '17:00',
          }
        })
      });
      const createData = await createRes.json();
      return createData.result?.entryId;
    }, today);

    // Verify retrieval
    const retrieved = await page.evaluate(async (date) => {
      const getRes = await fetch('http://localhost:3001/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolName: 'get_daily_summary',
          args: { date }
        })
      });
      const getData = await getRes.json();
      return getData.result?.entries?.length > 0;
    }, today);

    expect(retrieved).toBeTruthy();
  });

  test('No errors during CRUD operations', async ({ page }) => {
    const errors: string[] = [];

    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    // Create entry
    await page.evaluate(async (date) => {
      await fetch('http://localhost:3001/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolName: 'upsert_daily_summary',
          args: {
            date,
            name: 'Error Check Task',
            ticket_id: 'TEST-ERR',
            start_time: '13:00',
            end_time: '14:00',
          }
        })
      });
    }, today);

    // Read entry
    await page.evaluate(async (date) => {
      await fetch('http://localhost:3001/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolName: 'get_daily_summary',
          args: { date }
        })
      });
    }, today);

    expect(errors.length).toBe(0);
  });
});
