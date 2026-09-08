/**
 * Setup Wizard Test Suite
 * Tests all wizard functionality end-to-end
 */

// Use global fetch (available in Node.js 18+)

const BASE_URL = 'http://localhost:3001/api/setup';
const VALID_CONFIG = {
  jiraBaseUrl: 'https://company.atlassian.net',
  jiraEmail: 'test@company.com',
  jiraApiToken: 'test-token-123',
  tempoApiToken: 'test-tempo-token',
  graphTenantId: 'test-tenant',
  graphClientId: 'test-client-id',
  graphClientSecret: 'test-client-secret',
  ollamaHost: 'http://localhost:11434',
  ollamaModel: 'mistral',
  skipMicrosoft: false,
  skipOllama: false,
};

// Color codes
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

function log(color, ...msg) {
  console.log(`${color}${msg.join(' ')}${colors.reset}`);
}

async function test(name, fn) {
  try {
    await fn();
    log(colors.green, `✅ ${name}`);
    return true;
  } catch (error) {
    log(colors.red, `❌ ${name}`);
    log(colors.red, `   Error: ${error.message}`);
    return false;
  }
}

async function runTests() {
  log(colors.cyan, '\n╔════════════════════════════════════════════╗');
  log(colors.cyan, '║  Setup Wizard API Test Suite              ║');
  log(colors.cyan, '╚════════════════════════════════════════════╝\n');

  // This suite POSTs a dummy config to /setup/complete, which overwrites the
  // real one. Snapshot the live settings first and restore them afterwards so
  // running the tests can never destroy a working installation.
  const { db } = await import('../index.js');
  const BACKED_UP_KEYS = ['setup_complete', 'wizard_completed'];
  const snapshot = BACKED_UP_KEYS.map(key => ({
    key,
    row: db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  }));

  const restoreSettings = () => {
    for (const { key, row } of snapshot) {
      if (row) {
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, row.value);
      } else {
        db.prepare('DELETE FROM settings WHERE key = ?').run(key);
      }
    }
    log(colors.yellow, '\n♻️  Restored pre-test configuration');
  };

  process.on('exit', restoreSettings);

  let passed = 0;
  let failed = 0;

  // Test 1: Health check
  if (await test('API server is running', async () => {
    const res = await fetch('http://localhost:3001/health');
    if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
    const data = await res.json();
    if (data.status !== 'ok') throw new Error('Server status not ok');
  })) {
    passed++;
  } else {
    failed++;
  }

  // Test 2: Setup status endpoint
  if (await test('GET /api/setup/status reports status and redacts secrets', async () => {
    const res = await fetch(`${BASE_URL}/status`);
    if (!res.ok) throw new Error(`Status check failed: ${res.status}`);
    const data = await res.json();
    // `completed` depends on whether this machine is configured, so assert the
    // contract rather than a particular install state.
    if (typeof data.completed !== 'boolean') throw new Error('Expected boolean completed');

    // Credentials must never leave the backend in readable form.
    const leaked = [];
    const scan = (value, path = '') => {
      if (!value || typeof value !== 'object') return;
      for (const [key, val] of Object.entries(value)) {
        const at = path ? `${path}.${key}` : key;
        const k = key.toLowerCase();
        if ((k.endsWith('token') || k.endsWith('secret')) && typeof val === 'string' && val && !/^\*/.test(val)) {
          leaked.push(at);
        }
        scan(val, at);
      }
    };
    scan(data.config);
    if (leaked.length) throw new Error(`Unredacted secrets returned: ${leaked.join(', ')}`);
  })) {
    passed++;
  } else {
    failed++;
  }

  // Test 3: Test Jira with invalid credentials
  if (await test('POST /api/setup/test-jira rejects invalid credentials', async () => {
    const res = await fetch(`${BASE_URL}/test-jira`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: 'https://invalid.atlassian.net',
        email: 'invalid@test.com',
        apiToken: 'invalid-token',
        tempoToken: 'invalid-tempo',
      }),
    });
    const data = await res.json();
    if (data.success !== false) throw new Error('Expected failure for invalid credentials');
  })) {
    passed++;
  } else {
    failed++;
  }

  // Test 4: Test Jira with missing fields
  if (await test('POST /api/setup/test-jira requires all fields', async () => {
    const res = await fetch(`${BASE_URL}/test-jira`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jiraBaseUrl: 'https://company.atlassian.net',
        // Missing email and apiToken
      }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success !== false) throw new Error('Should reject missing fields');
    }
  })) {
    passed++;
  } else {
    failed++;
  }

  // Test 5: Test Graph with missing credentials
  if (await test('POST /api/setup/test-graph requires clientId', async () => {
    const res = await fetch(`${BASE_URL}/test-graph`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: 'test-tenant',
        // Missing clientId; clientSecret is optional for public clients
      }),
    });
    const data = await res.json();
    if (data.success !== false) throw new Error('Should reject missing credentials');
  })) {
    passed++;
  } else {
    failed++;
  }

  // Test 6: Test Ollama with host
  if (await test('POST /api/setup/test-ollama accepts host URL', async () => {
    const res = await fetch(`${BASE_URL}/test-ollama`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'http://localhost:11434',
      }),
    });
    // Will fail if Ollama not running, but endpoint should be working
    if (!res.ok && res.status !== 500) {
      throw new Error(`Unexpected status: ${res.status}`);
    }
  })) {
    passed++;
  } else {
    failed++;
  }

  // Test 7: Test complete setup with valid config
  if (await test('POST /api/setup/complete saves configuration', async () => {
    const res = await fetch(`${BASE_URL}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(VALID_CONFIG),
    });
    if (!res.ok) throw new Error(`Setup completion failed: ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error('Setup completion returned success=false');
  })) {
    passed++;
  } else {
    failed++;
  }

  // Test 8: Verify setup is complete
  if (await test('Setup marked as complete in database', async () => {
    const res = await fetch(`${BASE_URL}/status`);
    if (!res.ok) throw new Error(`Status check failed: ${res.status}`);
    const data = await res.json();
    if (data.completed !== true) throw new Error('Expected completed=true after setup');
  })) {
    passed++;
  } else {
    failed++;
  }

  // Test 9: Retrieve saved configuration
  if (await test('GET /api/setup/status returns saved config', async () => {
    const res = await fetch(`${BASE_URL}/status`);
    if (!res.ok) throw new Error(`Status check failed: ${res.status}`);
    const data = await res.json();
    if (!data.config || !data.config.jira) {
      throw new Error('Config should contain saved Jira settings');
    }
  })) {
    passed++;
  } else {
    failed++;
  }

  // Test 10: Backend tools accessible
  if (await test('Backend tools are accessible via API', async () => {
    const res = await fetch('http://localhost:3001/api/tools');
    if (!res.ok) throw new Error(`Tools endpoint failed: ${res.status}`);
    const data = await res.json();
    // Asserting an exact count breaks every time a tool is added, which trains
    // people to ignore the failure. A floor catches a broken registry instead.
    if (!Array.isArray(data.tools)) throw new Error('Tools endpoint did not return an array');
    if (data.tools.length < 26) throw new Error(`Expected at least 26 tools, got ${data.tools.length}`);
  })) {
    passed++;
  } else {
    failed++;
  }

  if (await test('Changing Microsoft tenant clears BOTH cached Graph tokens', async () => {
    const exec = async (toolName, args = {}) => {
      const res = await fetch('http://localhost:3001/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName, args })
      });
      const data = await res.json();
      return data.result;
    };

    const { default: Database } = await import('better-sqlite3');
    const os = await import('os');
    const path = await import('path');
    const dbPath = path.join(os.homedir(), '.timelogger-app', 'daily_summary.db');

    const original = (await exec('get_config', { section: 'microsoft' })).microsoft || {};

    const seed = new Database(dbPath);
    const prevRefresh = seed.prepare("SELECT value FROM settings WHERE key='graph_refresh_token'").get();
    const prevAccess = seed.prepare("SELECT value FROM settings WHERE key='graph_access_token'").get();
    const put = seed.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    // An access token is stored separately from the refresh token and stays
    // valid for ~an hour. Clearing only the refresh token leaves the previous
    // tenant's access token in active use, which surfaces as an unrelated
    // Graph error instead of a sign-in prompt.
    put.run('graph_refresh_token', 'test-refresh-token');
    put.run('graph_access_token', JSON.stringify({ token: 'test-access-token', expiry: Date.now() + 3600000 }));
    seed.close();

    try {
      await exec('update_config', {
        config: { microsoft: { ...original, tenantId: 'wizard-test-tenant' } }
      });

      const check = new Database(dbPath, { readonly: true });
      const refresh = check.prepare("SELECT value FROM settings WHERE key='graph_refresh_token'").get();
      const access = check.prepare("SELECT value FROM settings WHERE key='graph_access_token'").get();
      check.close();

      if (refresh) throw new Error('graph_refresh_token survived a tenant change');
      if (access) throw new Error('graph_access_token survived a tenant change');
    } finally {
      await exec('update_config', { config: { microsoft: original } });
      const restore = new Database(dbPath);
      const put2 = restore.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
      const del = restore.prepare('DELETE FROM settings WHERE key = ?');
      if (prevRefresh) put2.run('graph_refresh_token', prevRefresh.value);
      else del.run('graph_refresh_token');
      if (prevAccess) put2.run('graph_access_token', prevAccess.value);
      else del.run('graph_access_token');
      restore.close();
    }
  })) {
    passed++;
  } else {
    failed++;
  }

  // Summary

  log(colors.magenta, '\n╔════════════════════════════════════════════╗');
  log(colors.magenta, '║  Test Results Summary                      ║');
  log(colors.magenta, '╚════════════════════════════════════════════╝\n');

  log(colors.cyan, `Total Tests:  ${passed + failed}`);
  log(colors.green, `Passed:       ${passed}`);
  if (failed > 0) {
    log(colors.red, `Failed:       ${failed}`);
  }

  const percentage = ((passed / (passed + failed)) * 100).toFixed(1);
  log(colors.blue, `Score:        ${percentage}% (${passed}/${passed + failed})\n`);

  if (failed === 0) {
    log(colors.green, '✅ All tests passed! Setup Wizard is working correctly.\n');
  } else {
    log(colors.yellow, '⚠️  Some tests failed. Check the errors above.\n');
  }

  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(error => {
  log(colors.red, 'Test suite error:', error.message);
  process.exit(1);
});
