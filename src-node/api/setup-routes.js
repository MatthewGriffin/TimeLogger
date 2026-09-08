/**
 * Setup Wizard API Routes
 * Handles initial configuration and credential testing
 * 
 * All vault references removed - credentials now come from Settings page
 */

import express from 'express';
import crypto from 'crypto';
import { db } from '../index.js';
import { graphClient, readMicrosoftConfig, GRAPH_SCOPE_STRING, buildTokenEndpoint } from './graph-client.js';
import { ollamaClient } from './ollama-client.js';
import { setupLimiter } from './rate-limit.js';
import { safeJiraBaseUrl, safeOllamaHost, safeTenantId, escapeHtml } from '../utils/safe-url.js';

export const router = express.Router();

// Every route below is user-driven and most trigger an outbound call to a
// third party, so none of them should be callable in a tight loop.
router.use(setupLimiter);

// Must match the redirect URI registered in Azure and used by the sign-in URL.
const OAUTH_REDIRECT_URI = 'http://localhost:3001/api/setup/oauth-callback';

/**
 * Build a PKCE verifier/challenge pair.
 *
 * PKCE is mandatory for public client registrations (those without a secret)
 * and harmless for confidential ones, so the sign-in flow always uses it.
 */
function createPkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function storePkceVerifier(verifier) {
  db.prepare(`
    INSERT OR REPLACE INTO settings (key, value)
    VALUES ('microsoft_pkce_verifier', ?)
  `).run(verifier);
}

function takePkceVerifier() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('microsoft_pkce_verifier');
  db.prepare('DELETE FROM settings WHERE key = ?').run('microsoft_pkce_verifier');
  return row?.value || null;
}

// Field names whose values are credentials and must never leave the process.
const SECRET_KEYS = new Set([
  'apitoken', 'tempotoken', 'clientsecret', 'password', 'secret',
  'accesstoken', 'refreshtoken', 'clientassertion', 'authorization'
]);

const isSecretKey = (key) => {
  const k = String(key).toLowerCase();
  return SECRET_KEYS.has(k) || k.endsWith('token') || k.endsWith('secret');
};

/**
 * Replace credential values with a presence marker.
 *
 * The setup wizard only needs to know *whether* a credential is stored, never
 * what it is. Returning the raw value means any client, log sink or error
 * report that touches this response now holds a live token. `null` would be
 * ambiguous with "not configured", so a configured secret becomes a masked
 * string that shows only the last 4 characters.
 */
function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== 'object') return value;

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (isSecretKey(key)) {
      out[key] = typeof val === 'string' && val.length > 0
        ? `${'*'.repeat(Math.max(4, Math.min(12, val.length - 4)))}${val.slice(-4)}`
        : null;
      // An explicit flag keeps "configured" unambiguous for the UI.
      out[`${key}Configured`] = typeof val === 'string' && val.length > 0;
    } else {
      out[key] = redactSecrets(val);
    }
  }
  return out;
}

/**
 * Test Jira & Tempo Connection
 * POST /api/setup/test-jira
 */
router.post('/setup/test-jira', async (req, res) => {
  try {
    const { baseUrl, email, apiToken, tempoToken } = req.body;

    if (!baseUrl || !email || !apiToken) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: baseUrl, email, apiToken',
      });
    }

    const jiraOrigin = safeJiraBaseUrl(baseUrl);
    if (!jiraOrigin) {
      return res.status(400).json({
        success: false,
        message: 'Jira base URL must be a plain https:// address, for example https://your-site.atlassian.net',
      });
    }

    // Test Jira connection
    const jiraResponse = await fetch(`${jiraOrigin}/rest/api/3/myself`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
    });

    if (!jiraResponse.ok) {
      return res.status(400).json({
        success: false,
        message: `Jira connection failed (${jiraResponse.status}): ${jiraResponse.statusText}`,
      });
    }

    const user = await jiraResponse.json();

    // Save to database
    db.prepare(`
      INSERT OR REPLACE INTO settings (key, value)
      VALUES ('jira_config', ?)
    `).run(JSON.stringify({
      baseUrl: jiraOrigin,
      email,
      username: user.name || user.emailAddress,
    }));

    return res.json({
      success: true,
      message: `Connected to Jira as ${user.displayName || user.name}`,
      user: {
        name: user.displayName || user.name,
        email: user.emailAddress,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `Connection error: ${error.message}`,
    });
  }
});

/**
 * Test Tempo Connection
 * POST /api/setup/test-tempo
 */
router.post('/setup/test-tempo', async (req, res) => {
  try {
    const { tempoToken } = req.body;

    if (!tempoToken) {
      return res.status(400).json({
        success: false,
        message: 'Missing required field: tempoToken',
      });
    }

    const tempoResponse = await fetch('https://api.tempo.io/4/worklogs?limit=1', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${tempoToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!tempoResponse.ok) {
      let errorMsg = 'Invalid Tempo API token';
      if (tempoResponse.status === 401) {
        errorMsg = 'Invalid or expired Tempo API token';
      }
      return res.status(400).json({
        success: false,
        message: errorMsg,
      });
    }

    return res.json({
      success: true,
      message: 'Tempo API connected',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `Error: ${error.message}`,
    });
  }
});

/**
 * Test Microsoft Graph Connection
 * POST /api/setup/test-graph
 */
router.post('/setup/test-graph', async (req, res) => {
  try {
    const { tenantId, clientId, clientSecret } = req.body;

    if (!tenantId || !clientId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: tenantId, clientId',
      });
    }

    const safeTenant = safeTenantId(tenantId, null);
    if (!safeTenant) {
      return res.status(400).json({
        success: false,
        message: 'Tenant ID must be a directory GUID, a verified domain, or one of: common, organizations, consumers',
      });
    }

    // A public client registration has no secret. Microsoft rejects any secret
    // sent by one (AADSTS700025), and client_credentials cannot be used at all,
    // so validity is proven by the interactive sign-in instead.
    if (!clientSecret) {
      db.prepare(`
        INSERT OR REPLACE INTO settings (key, value)
        VALUES ('microsoft_config', ?)
      `).run(JSON.stringify({ tenantId: safeTenant, clientId, clientSecret: null, publicClient: true, connected: false }));

      return res.json({
        success: true,
        message: 'Saved as a public client (no secret). Sign in with Microsoft to finish connecting your account.',
        redirectUri: OAUTH_REDIRECT_URI,
        publicClient: true,
      });
    }

    // Validate using Microsoft identity endpoint
    const tokenResponse = await fetch(`https://login.microsoftonline.com/${safeTenant}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const detail = await tokenResponse.text();
      let message = `Microsoft authentication failed (${tokenResponse.status})`;
      let code = '';
      try {
        const parsed = JSON.parse(detail);
        message = parsed.error_description || message;
        code = parsed.error_description || '';
      } catch {
        // keep generic message
      }

      // The registration is public: keep the client id but drop the secret so
      // sign-in uses the PKCE flow rather than failing again.
      if (code.includes('AADSTS700025')) {
        db.prepare(`
          INSERT OR REPLACE INTO settings (key, value)
          VALUES ('microsoft_config', ?)
        `).run(JSON.stringify({ tenantId: safeTenant, clientId, clientSecret: null, publicClient: true, connected: false }));

        return res.json({
          success: true,
          message:
            'This is a public client registration, so the secret was discarded. Sign in with Microsoft to finish connecting your account.',
          redirectUri: OAUTH_REDIRECT_URI,
          publicClient: true,
        });
      }

      return res.status(400).json({
        success: false,
        message,
      });
    }

    // Persist credentials so the OAuth callback can redeem the code. Mirrors
    // what test-jira and test-ollama already do on success.
    db.prepare(`
      INSERT OR REPLACE INTO settings (key, value)
      VALUES ('microsoft_config', ?)
    `).run(JSON.stringify({ tenantId: safeTenant, clientId, clientSecret, publicClient: false, connected: true }));

    // Only credential validity is checked here. Calling /me would fail by
    // design because this is an app-only token, while calendar and OneNote
    // access uses the delegated sign-in flow below.
    return res.json({
      success: true,
      message: 'Credentials verified. Sign in with Microsoft to finish connecting your account.',
      redirectUri: OAUTH_REDIRECT_URI,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `Microsoft setup failed: ${error.message}`,
    });
  }
});

/**
 * Build the Microsoft sign-in URL
 * GET /api/setup/oauth-authorize-url
 *
 * Centralised so the redirect URI, scopes and PKCE challenge are guaranteed to
 * match what the callback later sends to the token endpoint.
 */
router.get('/setup/oauth-authorize-url', async (req, res) => {
  try {
    const stored = readMicrosoftConfig();
    if (!stored?.clientId) {
      return res.status(400).json({
        success: false,
        message: 'Microsoft credentials are missing. Save them in Settings before signing in.',
      });
    }

    const { verifier, challenge } = createPkcePair();
    storePkceVerifier(verifier);

    const params = new URLSearchParams({
      client_id: stored.clientId,
      response_type: 'code',
      redirect_uri: OAUTH_REDIRECT_URI,
      response_mode: 'query',
      scope: GRAPH_SCOPE_STRING,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });

    const tenantId = safeTenantId(stored.tenantId, 'common');
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'The stored tenant ID is not valid. Re-enter it in Settings.',
      });
    }

    return res.json({
      success: true,
      url: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params.toString()}`,
      redirectUri: OAUTH_REDIRECT_URI,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `Could not build sign-in URL: ${error.message}`,
    });
  }
});

/**
 * OAuth Token Exchange
 * POST /api/setup/oauth-token
 */
router.post('/setup/oauth-token', async (req, res) => {
  try {
    const { tenantId, clientId, clientSecret, code, redirectUri } = req.body;

    const effectiveTenantId = safeTenantId(tenantId, 'common');
    if (!effectiveTenantId) {
      return res.status(400).json({
        success: false,
        message: 'Tenant ID must be a directory GUID, a verified domain, or one of: common, organizations, consumers',
      });
    }

    const scope = 'openid profile offline_access https://graph.microsoft.com/Calendars.Read https://graph.microsoft.com/Notes.ReadWrite';
    const tokenBody = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      scope,
    });

    const response = await fetch(`https://login.microsoftonline.com/${effectiveTenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenBody.toString(),
    });

    const text = await response.text();
    if (!response.ok) {
      return res.status(400).json({
        success: false,
        message: `Token exchange failed (${response.status}): ${text}`,
      });
    }

    const tokenData = JSON.parse(text);
    return res.json({
      success: true,
      tokenData,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `Token exchange failed: ${error.message}`,
    });
  }
});

/**
 * OAuth Callback Handler
 * GET /api/setup/oauth-callback
 *
 * Redeems the authorization code for tokens immediately. Without this the
 * refresh token is never stored and every Graph-backed tool reports
 * "not configured".
 */
router.get('/setup/oauth-callback', async (req, res) => {
  /**
   * Render the status page.
   *
   * `message` is always a literal written here; `detail` carries values from
   * the query string or from an upstream error body, so it is escaped. Doing
   * the escaping inside the template means no call site can forget it.
   */
  const page = (title, message, detail = '') => `
      <html>
        <body style="font-family: system-ui, sans-serif; text-align: center; padding: 50px;">
          <h2>${escapeHtml(title)}</h2>
          <p>${message}</p>
          ${detail ? `<p style="color:#b00;">${escapeHtml(detail)}</p>` : ''}
        </body>
        <script>
          setTimeout(() => window.close(), 4000);
        </script>
      </html>
    `;

  const recordFailure = (message) => {
    db.prepare(`
      INSERT OR REPLACE INTO settings (key, value)
      VALUES ('microsoft_oauth_success', ?)
    `).run(JSON.stringify({
      success: false,
      message,
      timestamp: new Date().toISOString(),
    }));
  };

  try {
    const { code, error, error_description } = req.query;

    if (error) {
      const message = error_description || error;
      recordFailure(message);
      return res.send(page('Authentication Failed', 'You can close this window and try again.', message));
    }

    if (!code) {
      recordFailure('No authorization code received.');
      return res.send(page('Authentication Error', 'No authorization code received. You can close this window and try again.'));
    }

    const stored = readMicrosoftConfig();
    if (!stored?.clientId) {
      recordFailure('Microsoft credentials are missing. Save them in Settings before signing in.');
      return res.send(page('Setup Incomplete', 'Microsoft credentials are missing. Save them in Settings before signing in.'));
    }

    const tokenBody = new URLSearchParams({
      client_id: stored.clientId,
      code: String(code),
      redirect_uri: OAUTH_REDIRECT_URI,
      grant_type: 'authorization_code',
      scope: GRAPH_SCOPE_STRING,
    });

    // Public clients must not send a secret (AADSTS700025); they prove
    // possession with the PKCE verifier instead.
    if (stored.clientSecret) {
      tokenBody.set('client_secret', stored.clientSecret);
    }

    const verifier = takePkceVerifier();
    if (verifier) {
      tokenBody.set('code_verifier', verifier);
    }

    const exchange = async () =>
      fetch(buildTokenEndpoint(stored.tenantId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenBody.toString(),
      });

    let response = await exchange();
    let text = await response.text();

    // The registration turned out to be public. Drop the secret, remember that
    // for next time, and retry rather than making the user re-run the test.
    if (!response.ok && text.includes('AADSTS700025') && tokenBody.has('client_secret')) {
      tokenBody.delete('client_secret');
      db.prepare(`
        INSERT OR REPLACE INTO settings (key, value)
        VALUES ('microsoft_config', ?)
      `).run(JSON.stringify({
        tenantId: stored.tenantId,
        clientId: stored.clientId,
        clientSecret: null,
        publicClient: true,
        connected: false,
      }));

      response = await exchange();
      text = await response.text();
    }

    if (!response.ok) {
      let detail = text;
      try {
        detail = JSON.parse(text).error_description || text;
      } catch {
        // keep raw text
      }
      recordFailure(`Token exchange failed (${response.status}): ${detail}`);
      return res.send(page('Authentication Failed', 'Could not complete sign-in.', detail));
    }

    const tokenData = JSON.parse(text);
    if (!tokenData.refresh_token) {
      recordFailure('Microsoft did not return a refresh token. Ensure the "offline_access" scope is granted.');
      return res.send(page('Authentication Incomplete', 'Microsoft did not return a refresh token. Ensure the "offline_access" permission is granted to the app registration.'));
    }

    await graphClient.storeTokenResponse(tokenData);

    // Deliberately does not persist the authorization code: it is a secret and
    // is single-use once redeemed above.
    db.prepare(`
      INSERT OR REPLACE INTO settings (key, value)
      VALUES ('microsoft_oauth_success', ?)
    `).run(JSON.stringify({
      success: true,
      timestamp: new Date().toISOString(),
    }));

    res.send(page('Authentication Successful!', 'Microsoft account connected. You can close this window.'));
  } catch (error) {
    recordFailure(error.message);
    res.status(500).send(page('Error', 'Something went wrong completing sign-in.', error.message));
  }
});

/**
 * Test Ollama Connection
 * POST /api/setup/test-ollama
 */
router.post('/setup/test-ollama', async (req, res) => {
  try {
    const { host } = req.body;

    if (!host) {
      return res.status(400).json({
        success: false,
        message: 'Missing required field: host',
      });
    }

    const ollamaOrigin = safeOllamaHost(host);
    if (!ollamaOrigin) {
      return res.status(400).json({
        success: false,
        message: 'Ollama host must be an http:// or https:// address, for example http://localhost:11434',
      });
    }

    // Test Ollama endpoint
    const response = await fetch(`${ollamaOrigin}/api/tags`);

    if (!response.ok) {
      return res.status(400).json({
        success: false,
        message: `Ollama connection failed (${response.status}): ${response.statusText}`,
      });
    }

    const data = await response.json();
    const models = data.models || [];

    if (models.length === 0) {
      return res.json({
        success: true,
        message: `Connected to Ollama at ${ollamaOrigin}, but no models installed. Run 'ollama pull mistral' first.`,
        models: [],
        warning: true,
      });
    }

    // Save to database
    db.prepare(`
      INSERT OR REPLACE INTO settings (key, value)
      VALUES ('ollama_config', ?)
    `).run(JSON.stringify({
      host: ollamaOrigin,
      models: models.map(m => m.name),
    }));

    return res.json({
      success: true,
      message: `Connected to Ollama with ${models.length} model(s)`,
      models: models.map(m => m.name),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `Connection error: ${error.message}`,
    });
  }
});

/**
 * Decide the value to persist for a credential field.
 *
 * The wizard hydrates its fields from a redacted response, so a re-save can
 * echo back a mask ("********abcd") or a blank rather than the real secret.
 * Writing either would silently destroy a working credential, so both fall
 * back to what is already stored. A real token never begins with "*".
 */
function keepSecret(incoming, existing) {
  if (typeof incoming !== 'string' || incoming.trim() === '') return existing ?? null;
  if (/^\*+/.test(incoming)) return existing ?? null;
  return incoming;
}

/**
 * Complete Setup
 * POST /api/setup/complete
 */
router.post('/setup/complete', async (req, res) => {
  try {
    const config = req.body;

    console.log('📝 Completing setup with config:', redactSecrets(config));

    // Previously stored secrets, used to survive a redacted round-trip.
    let previous = {};
    try {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'setup_complete'").get();
      if (row) previous = JSON.parse(row.value);
    } catch {
      // A corrupt row must not block setup; treat it as absent.
    }

    const jiraApiToken = keepSecret(config.jiraApiToken, previous.jira?.apiToken);
    const tempoToken = keepSecret(config.tempoApiToken, previous.jira?.tempoToken);
    const graphClientSecret = keepSecret(config.graphClientSecret, previous.microsoft?.clientSecret);

    // Validate required fields
    if (!config.jiraBaseUrl || !jiraApiToken) {
      return res.status(400).json({
        success: false,
        message: 'Jira configuration is required',
      });
    }

    // Save complete configuration
    const fullConfig = {
      completed: true,
      completedAt: new Date().toISOString(),
      jira: {
        baseUrl: config.jiraBaseUrl,
        email: config.jiraEmail,
        apiToken: jiraApiToken,
        tempoToken: tempoToken,
      },
      microsoft: {
        enabled: !config.skipMicrosoft,
        tenantId: config.graphTenantId,
        clientId: config.graphClientId,
        clientSecret: graphClientSecret,
      },
      ollama: {
        enabled: !config.skipOllama,
        host: config.ollamaHost,
        model: config.ollamaModel,
      },
    };

    console.log('💾 Saving to database...');
    db.prepare(`
      INSERT OR REPLACE INTO settings (key, value)
      VALUES ('setup_complete', ?)
    `).run(JSON.stringify(fullConfig));

    // Mark setup as complete
    db.prepare(`
      INSERT OR REPLACE INTO settings (key, value)
      VALUES ('wizard_completed', ?)
    `).run('true');

    console.log('✅ Setup saved successfully');

    return res.status(200).json({
      success: true,
      message: 'Setup completed successfully',
      config: redactSecrets(fullConfig),
    });
  } catch (error) {
    console.error('❌ Setup completion error:', error);
    res.status(500).json({
      success: false,
      message: `Setup completion failed: ${error.message}`,
    });
  }
});

/**
 * Get Setup Status
 * GET /api/setup/status
 */
router.get('/setup/status', async (req, res) => {
  try {
    const completed = db.prepare(`
      SELECT value FROM settings WHERE key = 'wizard_completed'
    `).get();

    const config = db.prepare(`
      SELECT value FROM settings WHERE key = 'setup_complete'
    `).get();

    return res.json({
      completed: completed?.value === 'true',
      config: config ? redactSecrets(JSON.parse(config.value)) : null,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `Status check failed: ${error.message}`,
    });
  }
});

/**
 * Check OAuth Success Status
 * GET /api/setup/oauth-status
 */
router.get('/setup/oauth-status', async (req, res) => {
  try {
    const { clear } = req.query;

    const row = db.prepare(`
      SELECT value FROM settings WHERE key = 'microsoft_oauth_success'
    `).get();

    const state = row ? JSON.parse(row.value) : null;
    const connected = !!db.prepare("SELECT value FROM settings WHERE key = 'graph_refresh_token'").get();

    // Surfacing the account makes a wrong-account sign-in obvious: signing in
    // to an org tenant with a personal address yields a guest with no mailbox.
    let account = null;
    let capabilities = null;
    if (connected) {
      try {
        if (await graphClient.initialize()) {
          const user = await graphClient.getUserInfo();
          account = user?.mail || user?.userPrincipalName || user?.displayName || null;
          capabilities = await graphClient.getCapabilities();
        }
      } catch {
        // Advisory only; never fail the status check because of it.
      }
    }

    const response = {
      success: !!state?.success,
      // A recorded failure lets the UI stop polling and show the real reason
      // instead of waiting for a timeout.
      failed: state ? state.success === false : false,
      message: state?.message || null,
      connected,
      account,
      capabilities,
      timestamp: state?.timestamp || null,
    };

    if (clear === 'true') {
      db.prepare(`
        DELETE FROM settings WHERE key = 'microsoft_oauth_success'
      `).run();
      console.log('🔄 OAuth success state cleared');
    }

    return res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `OAuth status check failed: ${error.message}`,
    });
  }
});

export default router;
