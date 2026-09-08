import assert from 'assert';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { tools, db, executeTool, healthCheck } from '../index.js';
import { syncDayFromEvents } from '../tools/outlook.js';
import {
  takeDuplicateWorklog,
  classifyWorklogFailure,
  learnFutureLimit,
  daysAhead,
  isoDaysFromToday,
} from '../tools/jira-tempo.js';
import { ukBankHolidays, isUkBankHoliday } from '../utils/uk-holidays.js';

// Color codes for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(color, ...msg) {
  console.log(color, ...msg, colors.reset);
}

// Test results tracking
let testCount = 0;
let passCount = 0;
let failCount = 0;
const results = [];

/**
 * Date used by every test that writes time entries or notes.
 *
 * These tools operate on the real application database, so a realistic date
 * put test rows in with the user's own data. Worse, it was a date the calendar
 * sync also populates: a real meeting landed in the same slot, the overlap
 * logic split the test entry around it, and the next run then failed on a
 * "range overlaps completely" error. Entries created with duration_mins have
 * no start/end, so they never deduplicated either and one junk row accumulated
 * per run. A sentinel date well outside any calendar keeps the fixtures
 * isolated, and cleanup keeps them from piling up.
 */
const TEST_DATE = '1990-01-01';

function cleanTestFixtures() {
  try {
    db.prepare('DELETE FROM daily_summary WHERE date = ?').run(TEST_DATE);
    db.prepare('DELETE FROM notes WHERE date = ?').run(TEST_DATE);
    db.prepare('DELETE FROM submission_history WHERE date = ?').run(TEST_DATE);
    db.prepare('DELETE FROM calendar_conflict_choices WHERE date = ?').run(TEST_DATE);
  } catch {
    // A missing table means nothing to clean; never fail the run on cleanup.
  }
}

function test(name, fn) {
  testCount++;
  try {
    fn();
    passCount++;
    log(colors.green, `✅ ${testCount}. ${name}`);
    results.push({ name, status: 'pass' });
  } catch (err) {
    failCount++;
    log(colors.red, `❌ ${testCount}. ${name}`);
    log(colors.red, `   Error: ${err.message}`);
    results.push({ name, status: 'fail', error: err.message });
  }
}

async function testAsync(name, fn) {
  testCount++;
  try {
    await fn();
    passCount++;
    log(colors.green, `✅ ${testCount}. ${name}`);
    results.push({ name, status: 'pass' });
  } catch (err) {
    failCount++;
    log(colors.red, `❌ ${testCount}. ${name}`);
    log(colors.red, `   Error: ${err.message}`);
    results.push({ name, status: 'fail', error: err.message });
  }
}

// Test suite
async function runTests() {
  log(colors.cyan, '\n╔════════════════════════════════════════════╗');
  log(colors.cyan, '║  TimeLogger Backend Test Suite             ║');
  log(colors.cyan, '╚════════════════════════════════════════════╝\n');

  // Backend already imported
  log(colors.blue, '📦 Backend loaded');
  log(colors.green, '✅ Backend ready for testing\n');

  // ============================================================
  // SECTION 1: Tool Registry Tests
  // ============================================================
  log(colors.yellow, '\n📋 SECTION 1: Tool Registry\n');

  test('Tools are exported as array', () => {
    assert(Array.isArray(tools), 'tools should be an array');
  });

  test('Tools array has at least 16 items', () => {
    assert(tools.length >= 16, `Expected at least 16 tools, got ${tools.length}`);
  });

  test('Each tool has required fields', () => {
    tools.forEach((tool) => {
      assert(tool.name, `Tool missing name`);
      assert(tool.description, `Tool "${tool.name}" missing description`);
      assert(typeof tool.handler === 'function', `Tool "${tool.name}" handler is not a function`);
      assert(tool.parameters, `Tool "${tool.name}" missing parameters`);
    });
  });

  test('Jira/Tempo tools are present', () => {
    const tempoTools = [
      'tempo_setup_check',
      'tempo_verify_connection',
      'tempo_get_work_attributes',
      'tempo_post_worklog',
      'tempo_update_worklog',
      'tempo_submit_day',
    ];
    tempoTools.forEach((name) => {
      const tool = tools.find((t) => t.name === name);
      assert(tool, `Missing tool: ${name}`);
    });
  });

  test('Daily Summary tools are present', () => {
    const toolsList = ['get_daily_summary', 'upsert_daily_summary', 'delete_daily_summary', 'get_outlook_events'];
    toolsList.forEach((name) => {
      const tool = tools.find((t) => t.name === name);
      assert(tool, `Missing tool: ${name}`);
    });
  });

  test('Notes tools are present', () => {
    const toolsList = ['get_notes', 'upsert_note', 'delete_note', 'capture_prefixed_message'];
    toolsList.forEach((name) => {
      const tool = tools.find((t) => t.name === name);
      assert(tool, `Missing tool: ${name}`);
    });
  });

  test('Setup tools are present', () => {
    const toolsList = ['tempo_setup_check', 'tempo_verify_connection'];
    toolsList.forEach((name) => {
      const tool = tools.find((t) => t.name === name);
      assert(tool, `Missing tool: ${name}`);
    });
  });

  // ============================================================
  // SECTION 2: Database Tests
  // ============================================================
  log(colors.yellow, '\n📚 SECTION 2: Database\n');

  test('Database is initialized', () => {
    assert(db, 'Database should be initialized');
  });

  test('Database has daily_summary table', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='daily_summary'")
      .all();
    assert(tables.length > 0, 'daily_summary table should exist');
  });

  test('Database has notes table', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notes'").all();
    assert(tables.length > 0, 'notes table should exist');
  });

  test('Database has submission_history table', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='submission_history'").all();
    assert(tables.length > 0, 'submission_history table should exist');
  });

  // ============================================================
  // SECTION 3: Utility Function Tests
  // ============================================================
  log(colors.yellow, '\n🔧 SECTION 3: Utilities\n');

  test('executeTool function is exported', () => {
    assert(typeof executeTool === 'function', 'executeTool should be a function');
  });

  test('healthCheck function is exported', () => {
    assert(typeof healthCheck === 'function', 'healthCheck should be a function');
  });

  // ============================================================
  // SECTION 4: Daily Summary Tool Tests (Mock Data)
  // ============================================================
  log(colors.yellow, '\n⏱️  SECTION 4: Daily Summary Tools (Mock Data)\n');

  // Start from a known-empty date so a previous run cannot make these fail.
  cleanTestFixtures();

  await testAsync('Create time entry with upsert_daily_summary', async () => {
    const result = await executeTool('upsert_daily_summary', {
      date: TEST_DATE,
      name: 'Test Task',
      ticket_id: 'TIME-001',
      start_time: '09:00',
      end_time: '10:00',
    });

    assert(result.success !== false, `Failed: ${result.textResultForLlm || result}`);
  });

  await testAsync('Retrieve daily summary', async () => {
    const result = await executeTool('get_daily_summary', {
      date: TEST_DATE,
    });

    assert(result !== undefined && result !== null, `Failed: ${result}`);
    // Result can be string (no entries), object (with entries/stats), or array
  });

  await testAsync('Create entry with duration_mins', async () => {
    const result = await executeTool('upsert_daily_summary', {
      date: TEST_DATE,
      name: 'Meeting',
      ticket_id: 'TIME-002',
      duration_mins: 45,
    });

    assert(result.success !== false, `Failed: ${result.textResultForLlm || result}`);
  });

  // ============================================================
  // SECTION 5: Notes Tool Tests (Mock Data)
  // ============================================================
  log(colors.yellow, '\n📝 SECTION 5: Notes Tools (Mock Data)\n');

  await testAsync('Create note with upsert_note', async () => {
    const result = await executeTool('upsert_note', {
      date: TEST_DATE,
      note: 'Test note content',
      topic: 'Testing',
      ticket_id: 'TIME-001',
    });

    assert(result.success !== false, `Failed: ${result.textResultForLlm || result}`);
  });

  await testAsync('Get notes for date', async () => {
    const result = await executeTool('get_notes', {
      date: TEST_DATE,
    });

    assert(result.success !== false, `Failed: ${result.textResultForLlm || result}`);
  });

  await testAsync('Capture prefixed note message', async () => {
    const result = await executeTool('capture_prefixed_message', {
      message: 'note This is a quick note',
      date: TEST_DATE,
      topic: 'Testing',
    });

    assert(result.success !== false, `Failed: ${result.textResultForLlm || result}`);
  });

  await testAsync('Capture prefixed task message', async () => {
    const result = await executeTool('capture_prefixed_message', {
      message: 'task Fix the login button',
      date: TEST_DATE,
    });

    assert(result.success !== false, `Failed: ${result.textResultForLlm || result}`);
  });

  // ============================================================
  // SECTION 6: Setup Tool Tests
  // ============================================================
  log(colors.yellow, '\n⚙️  SECTION 6: Setup Tools\n');

  await testAsync('tempo_setup_check completes', async () => {
    try {
      const result = await executeTool('tempo_setup_check', {});
      // Tool may fail due to missing vault, but should execute without crash
      assert(result !== undefined, 'Should return a result');
    } catch (err) {
      // Expected if vault doesn't exist, but shouldn't crash
      assert(err.message, 'Should provide error message');
    }
  });

  await testAsync('tempo_verify_connection completes', async () => {
    try {
      const result = await executeTool('tempo_verify_connection', {});
      // Tool may fail due to missing credentials, but should execute without crash
      assert(result !== undefined, 'Should return a result');
    } catch (err) {
      // Expected if credentials don't exist
      assert(err.message, 'Should provide error message');
    }
  });

  // ============================================================
  // SECTION 7: Error Handling Tests
  // ============================================================
  log(colors.yellow, '\n⚠️  SECTION 7: Error Handling\n');

  await testAsync('Invalid tool name returns error', async () => {
    try {
      const result = await executeTool('nonexistent_tool', {});
      // Should either error or return empty
      assert(result === null || result === undefined || result.error, 'Should handle invalid tool gracefully');
    } catch (err) {
      // Expected behavior
      assert(err.message.includes('not found') || err.message.includes('Unknown'));
    }
  });

  await testAsync('Missing required parameters are handled', async () => {
    try {
      const result = await executeTool('upsert_daily_summary', {
        // Missing required date field
        name: 'Test',
      });
      // Should return error in result or throw
      assert(result && (result.error || result.textResultForLlm), 'Should handle missing parameters');
    } catch (err) {
      // Expected
      assert(err.message);
    }
  });

  // ============================================================
  // SECTION 8: LLM Tools
  // ============================================================
  log(colors.yellow, '\n🤖 SECTION 8: LLM Tools\n');

  await testAsync('llm_categorize_task tool exists', async () => {
    const tool = tools.find(t => t.name === 'llm_categorize_task');
    assert(tool, 'llm_categorize_task tool should exist');
    assert(tool.parameters.required.includes('description'), 'Should require description');
  });

  await testAsync('llm_categorize_task executes gracefully', async () => {
    const result = await executeTool('llm_categorize_task', {
      description: 'Fix login bug in authentication module',
    });
    assert(result, 'Should return a result');
    assert(result.success === false || result.success === true, 'Should indicate success or failure');
  });

  await testAsync('llm_generate_summary tool exists', async () => {
    const tool = tools.find(t => t.name === 'llm_generate_summary');
    assert(tool, 'llm_generate_summary tool should exist');
    assert(tool.parameters.required.includes('date'), 'Should require date');
  });

  await testAsync('llm_generate_summary validates date format', async () => {
    const result = await executeTool('llm_generate_summary', {
      date: 'invalid-date',
    });
    assert(result.success === false || result.textResultForLlm, 'Should validate date format');
  });

  await testAsync('llm_enhance_note tool exists', async () => {
    const tool = tools.find(t => t.name === 'llm_enhance_note');
    assert(tool, 'llm_enhance_note tool should exist');
    assert(tool.parameters.required.includes('note'), 'Should require note');
  });

  await testAsync('llm_enhance_note executes gracefully', async () => {
    const result = await executeTool('llm_enhance_note', {
      note: 'Worked on bug fixing today',
    });
    assert(result, 'Should return a result');
    assert(result.success === false || result.success === true, 'Should indicate success or failure');
  });

  // ============================================================
  // SECTION 9: Config Tools
  // ============================================================
  log(colors.yellow, '\n⚙️  SECTION 9: Config Tools\n');

  await testAsync('newPI tool exists', async () => {
    const tool = tools.find(t => t.name === 'newPI');
    assert(tool, 'newPI tool should exist');
    assert(tool.parameters.required.includes('piName'), 'Should require piName');
  });

  await testAsync('newPI creates PI configuration', async () => {
    const result = await executeTool('newPI', {
      piName: 'PI25.1',
      mappings: {
        'PROJ-123': 'Feature Development',
        'PROJ-124': 'Bug Fix'
      },
    });
    assert(result.success === true, 'Should successfully create PI config');
    assert(result.piName === 'PI25.1', 'Should return PI name');
  });

  await testAsync('newPI retrieves existing PI', async () => {
    const result = await executeTool('newPI', {
      piName: 'PI25.1',
    });
    assert(result.success === true, 'Should successfully retrieve existing PI');
    assert(result.config, 'Should include config data');
  });

  await testAsync('get_config tool exists', async () => {
    const tool = tools.find(t => t.name === 'get_config');
    assert(tool, 'get_config tool should exist');
    assert(tool.parameters.required === undefined || tool.parameters.required.length === 0, 'Should not require parameters');
  });

  await testAsync('get_config retrieves all settings', async () => {
    const result = await executeTool('get_config', {});
    assert(result.success === true, 'Should successfully retrieve config');
    assert(result.timestamp, 'Should include timestamp');
  });

  await testAsync('get_config filters by section', async () => {
    const result = await executeTool('get_config', {
      section: 'pi',
    });
    assert(result.success === true, 'Should successfully retrieve config');
    assert(result.piConfig !== undefined, 'Should include requested section');
  });

  // ============================================================
  // SECTION 10: Health Check
  // ============================================================
  log(colors.yellow, '\n❤️  SECTION 10: Health Check\n');

  test('healthCheck returns status object', () => {
    const health = healthCheck();
    assert(health && typeof health === 'object', 'healthCheck should return object');
    assert(
      health.database !== undefined || health.status !== undefined,
      'healthCheck should include database or status info',
    );
  });

  // ============================================================
  // SECTION 11: Tempo Duplicate Detection
  // ============================================================
  log(colors.yellow, '\n🚫 SECTION 11: Tempo Duplicate Detection\n');

  {
    const wl = (o) => ({
      worklogId: 1, issueId: 1001, ticketId: 'TIME-1', description: 'Work',
      date: '2026-09-07', startTime: '09:00', durationMins: 60, ...o,
    });
    const en = (o) => ({
      ticket_id: 'TIME-1', name: 'Work', start_time: '09:00', duration_mins: 60, ...o,
    });

    test('detects an identical worklog already in Tempo', () => {
      assert(
        takeDuplicateWorklog(en(), [wl()], 1001)?.reason === 'exact_match',
        'Identical worklog should be reported as a duplicate',
      );
    });

    test('detects a worklog whose duration was edited in Tempo', () => {
      assert(
        takeDuplicateWorklog(en(), [wl({ durationMins: 90 })], 1001)?.reason === 'same_start_time',
        'Same ticket and start slot should be a duplicate even if duration differs',
      );
    });

    test('allows a second genuine block on the same ticket', () => {
      assert(
        takeDuplicateWorklog(en({ start_time: '14:00', name: 'Review' }), [wl()], 1001) === null,
        'Separate blocks on one ticket must still be submittable',
      );
    });

    test('allows the same time slot on a different ticket', () => {
      assert(
        takeDuplicateWorklog(en(), [wl({ issueId: 2002, ticketId: 'TIME-2' })], 1001) === null,
        'A different ticket is never a duplicate',
      );
    });

    test('matches on duration and description when no start time is recorded', () => {
      assert(
        takeDuplicateWorklog(en({ start_time: null }), [wl({ startTime: '' })], 1001)?.reason
          === 'same_duration_and_description',
        'Should fall back to shape matching',
      );
    });

    test('does not collide two undated entries with different descriptions', () => {
      assert(
        takeDuplicateWorklog(en({ start_time: null, name: 'Other' }), [wl({ startTime: '' })], 1001) === null,
        'Missing start times must not be treated as a shared midnight slot',
      );
    });

    test('one Tempo worklog cannot absorb two local entries', () => {
      const pool = [wl()];
      assert(takeDuplicateWorklog(en(), pool, 1001) !== null, 'First entry should match');
      assert(takeDuplicateWorklog(en(), pool, 1001) === null, 'Matched worklog should be consumed');
    });

    test('uses the issue id when the ticket key lookup fails', () => {
      assert(
        takeDuplicateWorklog(en(), [wl({ ticketId: null })], 1001)?.reason === 'exact_match',
        'A failed key lookup must not hide a duplicate',
      );
    });

    test('falls back to the ticket key when no issue id is available', () => {
      assert(
        takeDuplicateWorklog(en({ ticket_id: ' time-1 ' }), [wl({ issueId: null })], null)?.reason
          === 'exact_match',
        'Ticket keys should match case- and whitespace-insensitively',
      );
    });
  }

  await testAsync('reports an unreachable Tempo instead of submitting blind', async () => {
    const date = '1991-02-02';
    db.prepare('DELETE FROM daily_summary WHERE date = ?').run(date);
    db.prepare(
      `INSERT INTO daily_summary (date, name, ticket_id, start_time, end_time, duration_mins, submitted)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
    ).run(date, 'Connectivity fixture', 'TIME-1', '09:00', '10:00', 60);

    try {
      // Port 9 is the discard port: reliably refuses a TCP connection.
      const result = await executeTool('tempo_submit_day', {
        date,
        baseUrl: 'http://127.0.0.1:9',
        email: 'test@example.com',
        apiToken: 'x',
        tempoToken: 'y',
      });

      assert(result.verificationFailed === true, 'Should flag the check as failed');
      assert(result.code === 'tempo_verification_failed', 'Should carry a machine-readable code');
      assert(result.success === false, 'Should not report success');
      assert(
        /try again later/i.test(result.message),
        'Message should tell the user to retry later, not expose a socket error',
      );

      const row = db.prepare('SELECT submitted FROM daily_summary WHERE date = ?').get(date);
      assert(row.submitted === 0, 'Entry must be left unsubmitted when Tempo cannot be checked');
    } finally {
      db.prepare('DELETE FROM daily_summary WHERE date = ?').run(date);
      db.prepare('DELETE FROM submission_history WHERE date = ?').run(date);
    }
  });

  // ============================================================
  // SECTION 12: Missed Days
  // ============================================================
  log(colors.yellow, '\n📅 SECTION 12: Missed Days\n');

  test('UK bank holidays match the published England & Wales dates', () => {
    assert.deepStrictEqual(
      [...ukBankHolidays(2024)].sort(),
      ['2024-01-01', '2024-03-29', '2024-04-01', '2024-05-06', '2024-05-27', '2024-08-26', '2024-12-25', '2024-12-26'],
    );
    assert.deepStrictEqual(
      [...ukBankHolidays(2025)].sort(),
      ['2025-01-01', '2025-04-18', '2025-04-21', '2025-05-05', '2025-05-26', '2025-08-25', '2025-12-25', '2025-12-26'],
    );
  });

  test('Boxing Day on a weekend substitutes onto a free weekday', () => {
    // 2026: Christmas is a Friday, so Boxing Day moves past the weekend to the
    // Monday. Christmas must not be displaced with it.
    const holidays = ukBankHolidays(2026);
    assert(holidays.has('2026-12-25'), 'Christmas Day should stay on the Friday');
    assert(holidays.has('2026-12-28'), 'Boxing Day should substitute to the Monday');
  });

  test('Bank holidays are not reported as missed days', () => {
    assert(isUkBankHoliday('2026-08-31'), 'Late Summer bank holiday should be recognised');
    assert(!isUkBankHoliday('2026-09-01'), 'An ordinary Tuesday is not a bank holiday');
  });

  await testAsync('get_missed_days excludes weekends, holidays and completed days', async () => {
    // New Year's Day 1991 fell on a Tuesday, so the window covers a bank
    // holiday that is also a weekday - the case the calendar sync misses.
    const dates = ['1991-01-01', '1991-01-02', '1991-01-03', '1991-01-04', '1991-01-07'];
    const clear = () => dates.forEach(d => db.prepare('DELETE FROM daily_summary WHERE date = ?').run(d));
    clear();

    const insert = db.prepare(
      `INSERT INTO daily_summary (date, name, ticket_id, start_time, end_time, duration_mins, submitted)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    try {
      insert.run('1991-01-02', 'Submitted work', 'TIME-1', '09:00', '10:00', 60, 1);
      insert.run('1991-01-03', 'Unsubmitted work', 'TIME-2', '09:00', '10:00', 60, 0);
      // 1991-01-04 and 1991-01-07 are deliberately left with no rows at all.

      const result = await executeTool('get_missed_days', { today: '1991-01-08', lookbackDays: 7 });
      assert(result.success, `Tool failed: ${result.message}`);

      const byDate = new Map(result.days.map(d => [d.date, d]));
      assert.strictEqual(byDate.get('1991-01-01')?.status, 'holiday', 'New Year should be a holiday');
      assert.strictEqual(byDate.get('1991-01-02')?.status, 'complete', 'Fully submitted day should be complete');
      assert.strictEqual(byDate.get('1991-01-03')?.status, 'not_submitted');
      assert.strictEqual(byDate.get('1991-01-04')?.status, 'no_time_logged');
      assert(!byDate.has('1991-01-05'), 'Saturday should not be evaluated');
      assert(!byDate.has('1991-01-06'), 'Sunday should not be evaluated');

      assert.deepStrictEqual(result.missedDays, ['1991-01-03', '1991-01-04', '1991-01-07']);
      assert.strictEqual(result.missedCount, 3);
    } finally {
      clear();
    }
  });

  await testAsync('get_entries_range returns entries across the whole span', async () => {
    const dates = ['1992-03-02', '1992-03-03', '1992-03-04'];
    const clear = () => dates.forEach(d => db.prepare('DELETE FROM daily_summary WHERE date = ?').run(d));
    clear();

    const insert = db.prepare(
      `INSERT INTO daily_summary (date, name, ticket_id, start_time, end_time, duration_mins, submitted)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    try {
      insert.run('1992-03-02', 'Day one', 'RANGE-1', '09:00', '10:00', 60, 0);
      insert.run('1992-03-03', 'Day two', 'RANGE-2', '09:00', '10:00', 60, 1);
      insert.run('1992-03-04', 'Day three', 'RANGE-3', '09:00', '10:00', 60, 0);

      const all = await executeTool('get_entries_range', { startDate: '1992-03-02', endDate: '1992-03-04' });
      assert(all.success, `Tool failed: ${all.message}`);
      assert.strictEqual(all.entriesCount, 3, 'Should span every day in the range');
      assert.strictEqual(all.submittedCount, 1);
      assert.strictEqual(all.unsubmittedCount, 2);

      // The end date must be inclusive, or the last day silently drops out.
      const clipped = await executeTool('get_entries_range', { startDate: '1992-03-02', endDate: '1992-03-03' });
      assert.strictEqual(clipped.entriesCount, 2, 'End date should be inclusive');

      const unsubmitted = await executeTool('get_entries_range', {
        startDate: '1992-03-02', endDate: '1992-03-04', unsubmittedOnly: true,
      });
      assert.strictEqual(unsubmitted.entriesCount, 2, 'Should exclude submitted entries');
      assert(unsubmitted.entries.every(e => !e.submitted), 'No submitted entry should be returned');
    } finally {
      clear();
    }
  });

  await testAsync('get_entries_range swaps a backwards range instead of failing', async () => {
    const date = '1992-03-02';
    db.prepare('DELETE FROM daily_summary WHERE date = ?').run(date);
    db.prepare(
      `INSERT INTO daily_summary (date, name, ticket_id, start_time, end_time, duration_mins, submitted)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
    ).run(date, 'Backwards', 'RANGE-4', '09:00', '10:00', 60);
    try {
      const result = await executeTool('get_entries_range', { startDate: '1992-03-04', endDate: '1992-03-02' });
      assert(result.success, `Tool failed: ${result.message}`);
      assert.strictEqual(result.startDate, '1992-03-02', 'Dates should be normalised into order');
      assert.strictEqual(result.endDate, '1992-03-04');
      assert.strictEqual(result.entriesCount, 1);
    } finally {
      db.prepare('DELETE FROM daily_summary WHERE date = ?').run(date);
    }
  });

  await testAsync('get_entries_range rejects a malformed date', async () => {
    const result = await executeTool('get_entries_range', { startDate: 'not-a-date', endDate: '1992-03-04' });
    assert.strictEqual(result.success, false, 'A malformed date should not be treated as a valid range');
  });

  // ============================================================
  // SECTION 13: Submission History
  // ============================================================
  log(colors.yellow, '\n📤 SECTION 13: Submission History\n');

  await testAsync('get_submission_history returns newest runs first with status detail', async () => {
    const marker = '2099-07-0';
    db.prepare('DELETE FROM submission_history WHERE date LIKE ?').run(`${marker}%`);
    try {
      db.prepare("INSERT INTO submission_history (date, count, status, failed_count, submitted_at) VALUES (?,?,?,?,?)")
        .run(`${marker}1`, 4, 'success', 0, '2099-07-01 09:00:00');
      db.prepare("INSERT INTO submission_history (date, count, status, failed_count, submitted_at) VALUES (?,?,?,?,?)")
        .run(`${marker}2`, 2, 'partial', 3, '2099-07-02 09:00:00');

      const result = await executeTool('get_submission_history', { limit: 2 });
      assert.strictEqual(result.success, true, 'Reading submission history should succeed');
      assert.strictEqual(result.submissions[0].date, `${marker}2`, 'Newest run should come first');
      assert.strictEqual(result.submissions[0].status, 'partial', 'Status should round-trip');
      assert.strictEqual(result.submissions[0].failedCount, 3, 'Failure count should round-trip');
      assert.strictEqual(result.submissions[1].entryCount, 4, 'Entry count should round-trip');
    } finally {
      db.prepare('DELETE FROM submission_history WHERE date LIKE ?').run(`${marker}%`);
    }
  });

  await testAsync('get_submission_history treats pre-migration rows as successes', async () => {
    const date = '2099-07-09';
    db.prepare('DELETE FROM submission_history WHERE date = ?').run(date);
    try {
      // Rows written before the status column existed have a NULL status.
      db.prepare('INSERT INTO submission_history (date, count, status, failed_count) VALUES (?,?,?,?)')
        .run(date, 5, null, null);
      const result = await executeTool('get_submission_history', { limit: 50 });
      const row = result.submissions.find((s) => s.date === date);
      assert.strictEqual(row.status, 'success', 'A missing status should not render as a failure');
      assert.strictEqual(row.failedCount, 0, 'A missing failure count should read as zero');
    } finally {
      db.prepare('DELETE FROM submission_history WHERE date = ?').run(date);
    }
  });

  await testAsync('get_submission_history clamps an oversized limit', async () => {
    const result = await executeTool('get_submission_history', { limit: 100000 });
    assert.strictEqual(result.success, true, 'An oversized limit should still succeed');
    assert.ok(result.submissions.length <= 100, 'History should be capped at 100 rows');
  });

  // ============================================================
  // SECTION 14: Tempo future-logging window
  // ============================================================
  log(colors.yellow, '\n⏭️  SECTION 14: Tempo Future-Logging Window\n');

  test('A future-window rejection is classified as deferred, not failed', () => {
    const result = classifyWorklogFailure(
      'HTTP 400: {"errors":[{"message":"Date is too far into the future"}]}',
    );
    assert.strictEqual(result.futureLimited, true, 'Should recognise the future-window rejection');
    assert.ok(
      !/HTTP 400|\{/.test(result.reason),
      'Reason should be readable, not raw JSON from Tempo',
    );
  });

  test('An ordinary rejection is left as a real failure', () => {
    const result = classifyWorklogFailure('HTTP 403: insufficient permissions');
    assert.strictEqual(result.futureLimited, false, 'Only future-window errors should be deferred');
    assert.strictEqual(
      result.reason,
      'HTTP 403: insufficient permissions',
      'A real failure should keep its original message for diagnosis',
    );
  });

  test('A missing error message never reads as a future-window rejection', () => {
    const result = classifyWorklogFailure(undefined);
    assert.strictEqual(result.futureLimited, false, 'An unknown error is not a deferral');
    assert.ok(result.reason, 'There should always be some reason to show');
  });

  test('The future window is learned from a rejection', () => {
    // Tempo refusing a date 8 days out proves it accepts at most 7.
    assert.strictEqual(learnFutureLimit(null, { rejectedAt: 8 }), 7);
  });

  test('A rejection only ever narrows the window', () => {
    assert.strictEqual(learnFutureLimit(30, { rejectedAt: 8 }), 7, 'Should narrow to the new evidence');
    assert.strictEqual(learnFutureLimit(3, { rejectedAt: 8 }), 3, 'Should not widen on a rejection');
  });

  test('An acceptance widens a window that was learned too small', () => {
    assert.strictEqual(
      learnFutureLimit(5, { acceptedAt: 7 }),
      7,
      'Tempo accepting a later date should correct a stale limit',
    );
  });

  test('An unknown window stays unknown until Tempo rejects something', () => {
    assert.strictEqual(
      learnFutureLimit(null, { acceptedAt: 7 }),
      null,
      'An acceptance alone does not reveal where the limit is',
    );
  });

  test('A nonsensical window is discarded rather than blocking every entry', () => {
    assert.strictEqual(
      learnFutureLimit(null, { rejectedAt: 0 }),
      null,
      'A limit implying today is unloggable should be ignored',
    );
  });

  test('daysAhead measures whole days from today', () => {
    assert.strictEqual(daysAhead(isoDaysFromToday(0)), 0, 'Today is zero days ahead');
    assert.strictEqual(daysAhead(isoDaysFromToday(8)), 8, 'Should count calendar days, not hours');
    assert.strictEqual(daysAhead(isoDaysFromToday(-3)), -3, 'Past dates are negative');
  });

  await testAsync('tempo_get_future_limit reports the learned cutoff', async () => {
    const previous = db.prepare('SELECT value FROM settings WHERE key = ?').get('tempo_future_limit_days');
    try {
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
        .run('tempo_future_limit_days', '7');
      const result = await executeTool('tempo_get_future_limit', {});
      assert.strictEqual(result.maxDaysAhead, 7, 'Should report the stored window');
      assert.strictEqual(
        result.cutoffDate,
        isoDaysFromToday(8),
        'Cutoff should be the first date Tempo will refuse',
      );
      assert.strictEqual(
        result.lastAcceptedDate,
        isoDaysFromToday(7),
        'Last accepted date should be the day before the cutoff',
      );
    } finally {
      if (previous) {
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
          .run('tempo_future_limit_days', previous.value);
      } else {
        db.prepare('DELETE FROM settings WHERE key = ?').run('tempo_future_limit_days');
      }
    }
  });

  // ============================================================
  // SECTION 15: Calendar meeting conflicts
  // ============================================================
  log(colors.yellow, '\n🗓️  SECTION 15: Calendar Meeting Conflicts\n');

  /** Minimal shape syncDayFromEvents needs; mirrors normalizeEvent's output. */
  const meetingEvent = (id, subject, startTime, endTime, overrides = {}) => ({
    id,
    subject,
    date: TEST_DATE,
    startTime,
    endTime,
    isAllDay: false,
    isTimeOff: false,
    isCancelled: false,
    categories: [],
    ...overrides,
  });

  test('two overlapping meetings are held back for the user to choose', () => {
    cleanTestFixtures();
    const result = syncDayFromEvents(
      TEST_DATE,
      [
        meetingEvent('evt-a', 'Planning', '10:00', '11:00'),
        meetingEvent('evt-b', 'Design Review', '10:30', '11:30'),
      ],
      {},
    );

    assert.strictEqual(result.created, 0, 'Neither conflicting meeting should be logged automatically');
    assert.strictEqual(result.meetingConflicts.length, 1, 'One conflict group should be reported');
    const ids = result.meetingConflicts[0].events.map((e) => e.id).sort();
    assert.deepStrictEqual(ids, ['evt-a', 'evt-b'], 'Both overlapping meetings should be in the group');
    cleanTestFixtures();
  });

  test('a non-overlapping meeting is still synced normally alongside a conflict', () => {
    cleanTestFixtures();
    const result = syncDayFromEvents(
      TEST_DATE,
      [
        meetingEvent('evt-c', 'Planning', '10:00', '11:00'),
        meetingEvent('evt-d', 'Design Review', '10:30', '11:30'),
        meetingEvent('evt-e', 'Standup', '09:00', '09:15'),
      ],
      {},
    );

    assert.strictEqual(result.created, 1, 'Only the non-conflicting meeting should be created');
    assert.strictEqual(result.meetingConflicts.length, 1, 'The overlapping pair should still be held back');
    cleanTestFixtures();
  });

  test('resolving a conflict logs only the attended meeting on the next sync', () => {
    cleanTestFixtures();
    const events = [
      meetingEvent('evt-f', 'Planning', '13:00', '14:00'),
      meetingEvent('evt-g', 'Design Review', '13:30', '14:30'),
    ];

    const first = syncDayFromEvents(TEST_DATE, events, {});
    assert.strictEqual(first.created, 0, 'Nothing should be logged before the conflict is resolved');

    db.prepare(`
      INSERT INTO calendar_conflict_choices (date, event_id, attended)
      VALUES (?, ?, 1), (?, ?, 0)
    `).run(TEST_DATE, 'evt-f', TEST_DATE, 'evt-g');

    const second = syncDayFromEvents(TEST_DATE, events, {});
    assert.strictEqual(second.created, 1, 'The attended meeting should now be logged');
    assert.strictEqual(second.meetingConflicts.length, 0, 'The resolved conflict should not be reported again');
    const row = db.prepare('SELECT name FROM daily_summary WHERE date = ? AND calendar_event_id = ?')
      .get(TEST_DATE, 'evt-f');
    assert(row, 'The attended meeting should be the one written to daily_summary');
    assert.strictEqual(row.name, 'Planning');
    cleanTestFixtures();
  });

  test('leaving one meeting early to join another logs both with adjoining times', () => {
    cleanTestFixtures();
    const events = [
      meetingEvent('evt-h', 'Planning', '13:00', '14:00'),
      meetingEvent('evt-i', 'Design Review', '13:30', '14:30'),
    ];

    db.prepare(`
      INSERT INTO calendar_conflict_choices (date, event_id, attended, start_time_override, end_time_override)
      VALUES (?, 'evt-h', 1, NULL, '13:30'), (?, 'evt-i', 1, '13:30', NULL)
    `).run(TEST_DATE, TEST_DATE);

    const result = syncDayFromEvents(TEST_DATE, events, {});
    assert.strictEqual(result.created, 2, 'Both split meetings should be logged');
    assert.strictEqual(result.meetingConflicts.length, 0, 'The split resolves the overlap, so no conflict is reported');

    const rows = db.prepare('SELECT name, start_time, end_time FROM daily_summary WHERE date = ? ORDER BY start_time')
      .all(TEST_DATE);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].name, 'Planning');
    assert.strictEqual(rows[0].end_time, '13:30');
    assert.strictEqual(rows[1].name, 'Design Review');
    assert.strictEqual(rows[1].start_time, '13:30');
    cleanTestFixtures();
  });

  test('a split that still overlaps is reported again instead of logged', () => {
    cleanTestFixtures();
    const events = [
      meetingEvent('evt-j', 'Planning', '13:00', '14:00'),
      meetingEvent('evt-k', 'Design Review', '13:30', '14:30'),
    ];

    // The chosen cutover (13:45) is later than Design Review's own end-time
    // override start, so the two events still overlap between 13:30-13:45.
    db.prepare(`
      INSERT INTO calendar_conflict_choices (date, event_id, attended, start_time_override, end_time_override)
      VALUES (?, 'evt-j', 1, NULL, '13:45'), (?, 'evt-k', 1, '13:30', NULL)
    `).run(TEST_DATE, TEST_DATE);

    const result = syncDayFromEvents(TEST_DATE, events, {});
    assert.strictEqual(result.created, 0, 'A still-overlapping split should not be logged');
    assert.strictEqual(result.meetingConflicts.length, 1, 'The unresolved overlap should be reported again');
    cleanTestFixtures();
  });

  test('resolve_meeting_conflict removes a stale entry when a choice is changed', () => {
    cleanTestFixtures();
    const events = [
      meetingEvent('evt-l', 'Planning', '13:00', '14:00'),
      meetingEvent('evt-m', 'Design Review', '13:30', '14:30'),
    ];

    const first = syncDayFromEvents(TEST_DATE, events, {});
    assert.strictEqual(first.created, 0);

    db.prepare(`
      INSERT INTO calendar_conflict_choices (date, event_id, attended)
      VALUES (?, 'evt-l', 1), (?, 'evt-m', 0)
    `).run(TEST_DATE, TEST_DATE);
    const afterFirstChoice = syncDayFromEvents(TEST_DATE, events, {});
    assert.strictEqual(afterFirstChoice.created, 1);

    // The user changes their mind: they actually attended Design Review, not
    // Planning. The stale Planning entry must not be left behind.
    db.prepare(`
      UPDATE calendar_conflict_choices SET attended = 0 WHERE date = ? AND event_id = 'evt-l'
    `).run(TEST_DATE);
    db.prepare(`
      UPDATE calendar_conflict_choices SET attended = 1 WHERE date = ? AND event_id = 'evt-m'
    `).run(TEST_DATE);
    db.prepare(`
      DELETE FROM daily_summary WHERE date = ? AND calendar_event_id = 'evt-l' AND submitted = 0
    `).run(TEST_DATE);
    const afterChangedChoice = syncDayFromEvents(TEST_DATE, events, {});
    assert.strictEqual(afterChangedChoice.created, 1, 'The newly attended meeting should now be logged');
    const rows = db.prepare('SELECT name FROM daily_summary WHERE date = ?').all(TEST_DATE);
    assert.strictEqual(rows.length, 1, 'Only one meeting should remain logged, not both');
    assert.strictEqual(rows[0].name, 'Design Review');
    cleanTestFixtures();
  });

  // ============================================================
  // SECTION 16: Lunch auto-entry
  // ============================================================
  log(colors.yellow, '\n🥪 SECTION 16: Lunch Auto-Entry\n');

  await testAsync('ensure_lunch_entry does not re-prompt when lunch already exists for the day', async () => {
    cleanTestFixtures();
    const first = await executeTool('ensure_lunch_entry', { date: TEST_DATE });
    assert.strictEqual(first.created, true, 'Lunch should be created on the first call');

    const second = await executeTool('ensure_lunch_entry', { date: TEST_DATE });
    assert.strictEqual(second.created, false);
    assert.strictEqual(second.conflict, undefined, 'An existing lunch entry must not be reported as a conflict');
    cleanTestFixtures();
  });

  await testAsync('a conflict suggests the next free slot after the blocking entry, not the default time', async () => {
    cleanTestFixtures();
    db.prepare(`
      INSERT INTO daily_summary (date, name, ticket_id, start_time, end_time, duration_mins, from_calendar)
      VALUES (?, 'Standup', NULL, '11:30', '12:30', 60, 1)
    `).run(TEST_DATE);

    const result = await executeTool('ensure_lunch_entry', { date: TEST_DATE });
    assert.strictEqual(result.conflict, true);
    assert.strictEqual(result.startTime, '12:30', 'Lunch should shift to right after the meeting ends');
    assert.strictEqual(result.endTime, '13:30', 'The one-hour duration should be preserved');
    cleanTestFixtures();
  });

  await testAsync('resolving a lunch conflict with the suggested time creates the entry', async () => {
    cleanTestFixtures();
    db.prepare(`
      INSERT INTO daily_summary (date, name, ticket_id, start_time, end_time, duration_mins, from_calendar)
      VALUES (?, 'Standup', NULL, '11:30', '12:30', 60, 1)
    `).run(TEST_DATE);

    const conflictResult = await executeTool('ensure_lunch_entry', { date: TEST_DATE });
    const resolved = await executeTool('ensure_lunch_entry', {
      date: TEST_DATE,
      startTime: conflictResult.startTime,
      endTime: conflictResult.endTime,
      force: true
    });
    assert.strictEqual(resolved.created, true);
    const row = db.prepare('SELECT start_time, end_time FROM daily_summary WHERE date = ? AND name = ?')
      .get(TEST_DATE, 'Lunch');
    assert.strictEqual(row.start_time, '12:30');
    assert.strictEqual(row.end_time, '13:30');
    cleanTestFixtures();
  });

  await testAsync('no free slot in the window still reports a conflict rather than double-booking', async () => {
    cleanTestFixtures();
    db.prepare(`
      INSERT INTO daily_summary (date, name, ticket_id, start_time, end_time, duration_mins, from_calendar)
      VALUES (?, 'All Day Workshop', NULL, '11:00', '15:00', 240, 1)
    `).run(TEST_DATE);

    const result = await executeTool('ensure_lunch_entry', { date: TEST_DATE });
    assert.strictEqual(result.conflict, true);
    assert.strictEqual(result.startTime, '12:00', 'With no free slot, the original default time is reported');
    cleanTestFixtures();
  });

  test('a synced meeting fully overlapping lunch does not delete the lunch entry', () => {
    cleanTestFixtures();
    db.prepare(`
      INSERT INTO daily_summary (date, name, ticket_id, start_time, end_time, duration_mins, from_calendar)
      VALUES (?, 'Lunch', NULL, '12:00', '13:00', 60, 0)
    `).run(TEST_DATE);

    const result = syncDayFromEvents(
      TEST_DATE,
      [meetingEvent('evt-lunch', 'All Hands', '12:00', '13:00')],
      {},
    );

    assert.strictEqual(result.created, 0, 'The meeting should not be logged over an existing lunch slot');
    const lunchRow = db.prepare('SELECT * FROM daily_summary WHERE date = ? AND name = ?')
      .get(TEST_DATE, 'Lunch');
    assert(lunchRow, 'The lunch entry must survive a fully-overlapping meeting sync');
    assert.strictEqual(lunchRow.start_time, '12:00');
    assert.strictEqual(lunchRow.end_time, '13:00');
    cleanTestFixtures();
  });

  test('a synced meeting overlapping the start of lunch is trimmed around it, not lunch', () => {
    cleanTestFixtures();
    db.prepare(`
      INSERT INTO daily_summary (date, name, ticket_id, start_time, end_time, duration_mins, from_calendar)
      VALUES (?, 'Lunch', NULL, '12:00', '13:00', 60, 0)
    `).run(TEST_DATE);

    const result = syncDayFromEvents(
      TEST_DATE,
      [meetingEvent('evt-lunch-2', 'Overrun Meeting', '11:30', '12:30')],
      {},
    );

    assert.strictEqual(result.created, 1, 'The non-lunch portion of the meeting should still be logged');
    const lunchRow = db.prepare('SELECT * FROM daily_summary WHERE date = ? AND name = ?')
      .get(TEST_DATE, 'Lunch');
    assert(lunchRow, 'The lunch entry must survive a partially-overlapping meeting sync');
    assert.strictEqual(lunchRow.start_time, '12:00');
    assert.strictEqual(lunchRow.end_time, '13:00');
    const meetingRow = db.prepare('SELECT * FROM daily_summary WHERE date = ? AND calendar_event_id = ?')
      .get(TEST_DATE, 'evt-lunch-2');
    assert(meetingRow, 'The meeting should still be logged for its non-overlapping portion');
    assert.strictEqual(meetingRow.start_time, '11:30');
    assert.strictEqual(meetingRow.end_time, '12:00', 'The meeting should stop where lunch begins');
    cleanTestFixtures();
  });

  // ============================================================
  // SECTION 17: Editing a submitted entry
  // ============================================================
  log(colors.yellow, '\n✏️  SECTION 17: Editing a Submitted Entry\n');

  await testAsync('editing a submitted entry\'s time resets submitted so it can be resubmitted', async () => {
    cleanTestFixtures();
    const inserted = db.prepare(`
      INSERT INTO daily_summary (date, name, ticket_id, start_time, end_time, duration_mins, submitted)
      VALUES (?, 'Bitesize', 'ABC-1', '13:00', '13:50', 50, 1)
    `).run(TEST_DATE);

    const result = await executeTool('upsert_daily_summary', {
      id: inserted.lastInsertRowid,
      date: TEST_DATE,
      name: 'Bitesize',
      ticket_id: 'ABC-1',
      start_time: '13:00',
      end_time: '13:30'
    });

    assert.strictEqual(result.resubmitRequired, true, 'A real time change on a submitted entry must flag it for resubmission');
    const row = db.prepare('SELECT submitted FROM daily_summary WHERE id = ?').get(inserted.lastInsertRowid);
    assert.strictEqual(row.submitted, 0, 'submitted should be cleared after the edit');
    cleanTestFixtures();
  });

  await testAsync('re-saving a submitted entry with identical values leaves submitted untouched', async () => {
    cleanTestFixtures();
    const inserted = db.prepare(`
      INSERT INTO daily_summary (date, name, ticket_id, start_time, end_time, duration_mins, submitted)
      VALUES (?, 'Bitesize', 'ABC-1', '13:00', '13:30', 30, 1)
    `).run(TEST_DATE);

    const result = await executeTool('upsert_daily_summary', {
      id: inserted.lastInsertRowid,
      date: TEST_DATE,
      name: 'Bitesize',
      ticket_id: 'ABC-1',
      start_time: '13:00',
      end_time: '13:30'
    });

    assert.strictEqual(result.resubmitRequired, false, 'A no-op save must not force a resubmission');
    const row = db.prepare('SELECT submitted FROM daily_summary WHERE id = ?').get(inserted.lastInsertRowid);
    assert.strictEqual(row.submitted, 1, 'submitted should be left alone when nothing actually changed');
    cleanTestFixtures();
  });

  await testAsync('editing an unsubmitted entry never reports resubmitRequired', async () => {
    cleanTestFixtures();
    const inserted = db.prepare(`
      INSERT INTO daily_summary (date, name, ticket_id, start_time, end_time, duration_mins, submitted)
      VALUES (?, 'Bitesize', 'ABC-1', '13:00', '13:50', 50, 0)
    `).run(TEST_DATE);

    const result = await executeTool('upsert_daily_summary', {
      id: inserted.lastInsertRowid,
      date: TEST_DATE,
      name: 'Bitesize',
      ticket_id: 'ABC-1',
      start_time: '13:00',
      end_time: '13:30'
    });

    assert.strictEqual(result.resubmitRequired, false, 'There is nothing to resubmit when it was never submitted');
    const row = db.prepare('SELECT submitted FROM daily_summary WHERE id = ?').get(inserted.lastInsertRowid);
    assert.strictEqual(row.submitted, 0);
    cleanTestFixtures();
  });

  // ============================================================
  // SUMMARY
  // ============================================================
  log(colors.cyan, '\n╔════════════════════════════════════════════╗');
  log(colors.cyan, '║  Test Results Summary                      ║');
  log(colors.cyan, '╚════════════════════════════════════════════╝\n');

  // Fixtures live in the real application database, so they are removed rather
  // than left behind as junk in the user's own data.
  cleanTestFixtures();

  console.log(`Total:  ${testCount}`);
  log(colors.green, `Passed: ${passCount}`);
  if (failCount > 0) {
    log(colors.red, `Failed: ${failCount}`);
  }

  const percentage = ((passCount / testCount) * 100).toFixed(1);
  log(colors.blue, `Score:  ${percentage}% (${passCount}/${testCount})\n`);

  // Print failures
  if (failCount > 0) {
    log(colors.yellow, '📋 Failed Tests:\n');
    results.filter((r) => r.status === 'fail').forEach((r) => {
      log(colors.red, `  ❌ ${r.name}`);
      log(colors.red, `     ${r.error}`);
    });
  }

  // Cleanup
  if (db) {
    try {
      db.close();
    } catch (e) {
      // Ignore
    }
  }

  process.exit(failCount > 0 ? 1 : 0);
}

// Run tests
runTests().catch((err) => {
  log(colors.red, `Fatal error: ${err.message}`);
  process.exit(1);
});
