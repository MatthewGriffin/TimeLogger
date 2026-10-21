import { test, expect, type APIRequestContext } from '@playwright/test';
import { BACKEND_URL, backendAvailable } from './helpers';

/**
 * Contract tests for the Node sidecar's tool API.
 *
 * These tests use a dedicated test database in CI. Local runs can still skip
 * when the sidecar is not running, but the quality workflow starts its own
 * isolated instance before invoking Playwright.
 */
const TEST_DATE = '1999-01-04';

/*
 * Tests run in parallel against this one date, and `upsert_daily_summary`
 * splits a new entry around any existing one it overlaps. Each test therefore
 * owns a disjoint slice of the day - overlapping ranges silently produce
 * shorter segments than the test asked for.
 *
 *   09:00-10:30  creates and reads back
 *   11:00-13:00  duration
 *   14:00-15:00  delete
 *   16:00-17:30  submitted flag
 */

/** IDs the current test created, torn down in afterEach. */
let createdIds: number[] = [];

async function callTool(request: APIRequestContext, toolName: string, args: Record<string, unknown>) {
  const res = await request.post(`${BACKEND_URL}/api/execute`, {
    data: { toolName, args },
  });
  expect(res.ok(), `${toolName} returned HTTP ${res.status()}`).toBe(true);
  return (await res.json()).result;
}

async function createEntry(request: APIRequestContext, args: Record<string, unknown>) {
  const result = await callTool(request, 'upsert_daily_summary', { date: TEST_DATE, ...args });
  for (const id of result?.entryIds ?? []) {
    if (!createdIds.includes(id)) createdIds.push(id);
  }
  return result;
}

async function fetchEntry(request: APIRequestContext, id: number) {
  const summary = await callTool(request, 'get_daily_summary', { date: TEST_DATE });
  return (summary.entries ?? []).find((e: { id: number }) => e.id === id);
}

test.describe('Backend sidecar API', () => {
  test.beforeAll(async () => {
    test.skip(!(await backendAvailable()), 'Node sidecar is not running on :3001');
  });

  test.beforeEach(() => {
    createdIds = [];
  });

  test.afterEach(async ({ request }) => {
    for (const id of createdIds) {
      await callTool(request, 'delete_daily_summary', { id });
    }
    createdIds = [];
  });

  test('health endpoint reports ok', async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/health`);
    expect(res.ok()).toBe(true);
  });

  test('exposes the tools the frontend depends on', async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/tools`);
    expect(res.ok()).toBe(true);

    const names: string[] = ((await res.json()).tools ?? []).map((t: { name: string }) => t.name);
    for (const required of [
      'get_daily_summary',
      'upsert_daily_summary',
      'delete_daily_summary',
      'get_missed_days',
    ]) {
      expect(names, `missing tool ${required}`).toContain(required);
    }
  });

  test('returns an explicit API failure for an unknown tool', async ({ request }) => {
    const res = await request.post(`${BACKEND_URL}/api/execute`, {
      data: { toolName: '__e2e_unknown_tool__', args: {} },
    });

    expect(res.status()).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toContain('not found');
  });

  test('creates an entry and reads it back', async ({ request }) => {
    const created = await createEntry(request, {
      name: 'E2E fixture',
      ticket_id: 'E2E-1',
      start_time: '09:00',
      end_time: '10:30',
    });

    expect(created.success).toBe(true);
    expect(created.entryId).toBeGreaterThan(0);

    const entry = await fetchEntry(request, created.entryId);
    expect(entry, 'created entry was not returned by get_daily_summary').toBeTruthy();
    expect(entry.name).toBe('E2E fixture');
    expect(entry.ticket_id).toBe('E2E-1');
  });

  test('derives duration from the start and end times', async ({ request }) => {
    const created = await createEntry(request, {
      name: 'Two hour task',
      ticket_id: 'E2E-2',
      start_time: '11:00',
      end_time: '13:00',
    });

    const entry = await fetchEntry(request, created.entryId);
    expect(entry.duration_mins).toBe(120);
  });

  test('deletes an entry', async ({ request }) => {
    const created = await createEntry(request, {
      name: 'Disposable',
      ticket_id: 'E2E-3',
      start_time: '14:00',
      end_time: '15:00',
    });

    const deleted = await callTool(request, 'delete_daily_summary', { id: created.entryId });
    expect(deleted.success).toBe(true);
    createdIds = createdIds.filter(id => id !== created.entryId);

    expect(await fetchEntry(request, created.entryId)).toBeFalsy();
  });

  test('editing an entry clears its submitted flag', async ({ request }) => {
    const created = await createEntry(request, {
      name: 'Already submitted',
      ticket_id: 'E2E-4',
      start_time: '16:00',
      end_time: '17:00',
      submitted: 1,
    });

    await createEntry(request, {
      id: created.entryId,
      name: 'Changed after submission',
      ticket_id: 'E2E-4',
      start_time: '16:00',
      end_time: '17:30',
    });

    const entry = await fetchEntry(request, created.entryId);
    expect(entry.submitted).toBeFalsy();
  });
});
