/**
 * Microsoft Graph API Client
 * 
 * Handles OAuth token management, rate limiting, and API calls to Microsoft Graph.
 * Used by OneNote and Outlook tools.
 * 
 * OAuth tokens are stored in database (settings table) instead of vault.
 */

import axios from 'axios';
import { db } from '../index.js';
import { microsoftAuthorityUrl } from '../utils/safe-url.js';

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

// Delegated scopes. The sign-in URL in api/setup-routes.js is built from
// GRAPH_SCOPE_STRING below, so the authorize and refresh requests stay in step;
// Microsoft rejects the refresh token if they ever diverge.
export const GRAPH_SCOPES = [
  'openid',
  'profile',
  'offline_access',
  'https://graph.microsoft.com/Calendars.Read',
  'https://graph.microsoft.com/Notes.ReadWrite'
];

export const GRAPH_SCOPE_STRING = GRAPH_SCOPES.join(' ');

/**
 * Build the Microsoft token endpoint for a tenant.
 *
 * The tenant is a path segment, so it is validated rather than interpolated
 * raw: an unchecked value could otherwise traverse out of the path and point
 * the token request - which carries the client secret - somewhere else.
 */
export function buildTokenEndpoint(tenantId) {
  const url = microsoftAuthorityUrl(tenantId, 'oauth2/v2.0/token');
  if (!url) {
    throw new Error('Invalid Microsoft tenant ID. Re-enter it in Settings.');
  }
  return url;
}

/**
 * Read the Microsoft credentials saved by the setup wizard.
 */
export function readMicrosoftConfig() {
  try {
    const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    const row = stmt.get('microsoft_config') || stmt.get('microsoftConfig');
    if (!row?.value) return null;
    const config = JSON.parse(row.value);
    return {
      tenantId: config.tenantId || config.graphTenantId || 'common',
      clientId: config.clientId || config.graphClientId || null,
      clientSecret: config.clientSecret || config.graphClientSecret || null
    };
  } catch (error) {
    console.error('Failed to read Microsoft config:', error.message);
    return null;
  }
}

// Rate limiting configuration
const RATE_LIMIT_RETRY_AFTER = 5000; // 5 seconds
const SERVER_ERROR_RETRY_AFTER = 1500; // doubles per attempt
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT = 30000; // 30 seconds

/**
 * Turn a Graph error into something a user can act on.
 *
 * Graph reports "this identity has no mailbox / no OneNote" as a bare 404,
 * which is indistinguishable from a wrong URL unless the error code is read.
 * That happens when signing in to an organisation tenant with a personal
 * account, which becomes a licence-less guest.
 */
export function describeGraphError(error) {
  const status = error.response?.status;
  const detail = error.response?.data?.error;
  const code = detail?.code || '';
  const raw = detail?.message || error.message;
  // OneNote sometimes answers with an HTML error page. Passing that straight
  // through fills the UI with markup instead of a readable reason.
  const looksLikeHtml = typeof raw === 'string' && /^\s*<(!doctype|html)/i.test(raw);
  const message = looksLikeHtml ? 'OneNote returned an error page' : raw;

  if (code === 'MailboxNotEnabledForRESTAPI' || /mailbox is either inactive/i.test(message)) {
    return 'This Microsoft account has no Outlook mailbox in the signed-in tenant. ' +
      'Sign in with the work account that owns the calendar, or set Tenant ID to "consumers" ' +
      'to use a personal Microsoft account.';
  }

  if (code === '30121' || /SharePoint license/i.test(message)) {
    return 'This Microsoft account has no OneNote/SharePoint licence in the signed-in tenant. ' +
      'Sign in with the licensed work account, or set Tenant ID to "consumers" to use a ' +
      'personal Microsoft account.';
  }

  if (status === 403) {
    return `Microsoft denied access (${code || 'forbidden'}): ${message}`;
  }

  if (status >= 500 && status < 600) {
    return `OneNote is temporarily unavailable (HTTP ${status}). Try again in a moment.`;
  }

  return status ? `${message} (HTTP ${status})` : message;
}

/**
 * GraphClient - Manages OAuth tokens and API calls
 */
class GraphClient {
  constructor() {
    this.token = null;
    this.tokenExpiry = null;
    this.clientId = null;
    this.clientSecret = null;
    this.tenantId = null;
    this.refreshToken = null;
    this.lastError = null;
  }

  /**
   * Drop all cached credentials and tokens.
   *
   * The access token, refresh token and tenant are all bound to one identity,
   * so a tenant or app-registration change must clear the in-memory copies —
   * otherwise this long-lived singleton keeps using the previous tenant's
   * token until the process restarts.
   */
  reset() {
    this.token = null;
    this.tokenExpiry = null;
    this.clientId = null;
    this.clientSecret = null;
    this.tenantId = null;
    this.refreshToken = null;
    this.lastError = null;
  }

  /**
   * Store refresh token in database
   */
  async saveRefreshToken(refreshToken) {
    try {
      const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
      stmt.run('graph_refresh_token', refreshToken);
    } catch (error) {
      console.error('Failed to save refresh token:', error.message);
    }
  }

  /**
   * Load refresh token from database
   */
  async loadRefreshToken() {
    try {
      const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
      const result = stmt.get('graph_refresh_token');
      return result?.value || null;
    } catch (error) {
      console.error('Failed to load refresh token:', error.message);
      return null;
    }
  }

  /**
   * Initialize with OAuth credentials.
   *
   * Credentials are optional: when omitted they are loaded from the
   * `microsoft_config` setting written by the setup wizard. Every caller in the
   * app relies on this, so changing the loading behaviour here affects OneNote
   * and Outlook alike.
   */
  async initialize(clientId, clientSecret, tenantId) {
    try {
      this.lastError = null;

      const stored = readMicrosoftConfig();
      this.clientId = clientId || stored?.clientId || null;
      this.clientSecret = clientSecret || stored?.clientSecret || null;
      this.tenantId = tenantId || stored?.tenantId || 'common';
      this.refreshToken = await this.loadRefreshToken();

      if (!this.clientId) {
        throw new Error(
          'Microsoft Graph is not configured. Add your Azure app credentials in Settings.'
        );
      }

      // Try to restore token from storage
      await this.restoreTokenFromStorage();

      // Refresh token if expired
      if (!this.token || this.isTokenExpired()) {
        if (!this.refreshToken) {
          throw new Error(
            'Microsoft account not connected. Open Settings and sign in with Microsoft.'
          );
        }

        const refreshed = await this.refreshAccessToken();
        if (!refreshed) {
          throw new Error(
            this.lastError ||
              'Microsoft sign-in has expired. Open Settings and sign in with Microsoft again.'
          );
        }
      }

      return true;
    } catch (error) {
      this.lastError = error.message;
      console.error('GraphClient initialization failed:', error.message);
      return false;
    }
  }

  /**
   * Check if current token is expired
   */
  isTokenExpired() {
    if (!this.tokenExpiry) return true;
    return Date.now() >= this.tokenExpiry - 300000; // 5 minute buffer
  }

  /**
   * Restore token from database storage
   */
  async restoreTokenFromStorage() {
    try {
      const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
      const result = stmt.get('graph_access_token');
      if (result) {
        const data = JSON.parse(result.value);
        this.token = data.token;
        this.tokenExpiry = data.expiry;
      }
    } catch (error) {
      console.error('Failed to restore token from storage:', error.message);
    }
  }

  /**
   * Save token to database storage
   */
  async saveTokenToStorage() {
    try {
      const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
      stmt.run('graph_access_token', JSON.stringify({
        token: this.token,
        expiry: this.tokenExpiry
      }));
    } catch (error) {
      console.error('Failed to save token to storage:', error.message);
    }
  }

  /**
   * Persist an authorization-code / refresh token response from the OAuth flow.
   */
  async storeTokenResponse(tokenData) {
    this.token = tokenData.access_token;
    this.tokenExpiry = Date.now() + ((tokenData.expires_in || 3600) * 1000);
    await this.saveTokenToStorage();

    if (tokenData.refresh_token) {
      this.refreshToken = tokenData.refresh_token;
      await this.saveRefreshToken(tokenData.refresh_token);
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken() {
    try {
      if (!this.refreshToken) {
        throw new Error('No refresh token available');
      }

      if (!this.clientId) {
        const stored = readMicrosoftConfig();
        this.clientId = this.clientId || stored?.clientId || null;
        this.clientSecret = this.clientSecret || stored?.clientSecret || null;
        this.tenantId = this.tenantId || stored?.tenantId || 'common';
      }

      // Microsoft's token endpoint only accepts form-encoded bodies; posting a
      // plain object (axios default JSON) is rejected with invalid_request.
      const body = new URLSearchParams({
        client_id: this.clientId,
        refresh_token: this.refreshToken,
        grant_type: 'refresh_token',
        scope: GRAPH_SCOPE_STRING
      });

      // Public client registrations must not send a secret (AADSTS700025).
      if (this.clientSecret) {
        body.set('client_secret', this.clientSecret);
      }

      const response = await axios.post(buildTokenEndpoint(this.tenantId), body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: REQUEST_TIMEOUT
      });

      this.token = response.data.access_token;
      this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);

      // Update refresh token if new one provided
      if (response.data.refresh_token) {
        this.refreshToken = response.data.refresh_token;
        await this.saveRefreshToken(this.refreshToken);
      }

      // Save to storage
      await this.saveTokenToStorage();

      return true;
    } catch (error) {
      const detail = error.response?.data?.error_description || error.message;
      this.lastError = `Failed to refresh Microsoft access token: ${detail}`;
      console.error(this.lastError);
      return false;
    }
  }

  /**
   * Make authenticated API call with retry logic
   */
  async apiCall(method, endpoint, data = null, retryCount = 0, options = {}) {
    try {
      // Ensure we have a valid token
      if (!this.token || this.isTokenExpired()) {
        await this.refreshAccessToken();
      }

      const config = {
        method,
        url: `${GRAPH_BASE_URL}${endpoint}`,
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': options.contentType || 'application/json',
          'Accept': 'application/json'
        },
        timeout: REQUEST_TIMEOUT
      };

      if (data) {
        config.data = data;
      }

      const response = await axios(config);
      return response.data;
    } catch (error) {
      // Handle rate limiting (429)
      if (error.response?.status === 429 && retryCount < MAX_RETRIES) {
        const retryAfter = error.response.headers['retry-after'] 
          ? parseInt(error.response.headers['retry-after']) * 1000 
          : RATE_LIMIT_RETRY_AFTER;
        
        console.warn(`Rate limited. Retrying in ${retryAfter}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
        
        await new Promise(resolve => setTimeout(resolve, retryAfter));
        return this.apiCall(method, endpoint, data, retryCount + 1, options);
      }

      // Handle token expiry
      if (error.response?.status === 401 && retryCount < 1) {
        console.warn('Token expired, refreshing...');
        await this.refreshAccessToken();
        return this.apiCall(method, endpoint, data, retryCount + 1, options);
      }

      // The OneNote endpoints return a transient 503 (sometimes as an HTML
      // error page) often enough that a single failure would otherwise show up
      // as "no sections", making a saved section look lost.
      const status = error.response?.status;
      if (status >= 500 && status < 600 && retryCount < MAX_RETRIES) {
        const backoff = SERVER_ERROR_RETRY_AFTER * Math.pow(2, retryCount);
        console.warn(`Graph returned ${status}. Retrying in ${backoff}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        return this.apiCall(method, endpoint, data, retryCount + 1, options);
      }

      throw new Error(describeGraphError(error));
    }
  }

  /**
   * Get user's OneNote notebooks
   */
  async getNotebooks() {
    const response = await this.apiCall('GET', '/me/onenote/notebooks');
    return response.value || [];
  }

  /**
   * Get sections in a notebook
   */
  async getNotebookSections(notebookId) {
    const response = await this.apiCall('GET', `/me/onenote/notebooks/${notebookId}/sections`);
    return response.value || [];
  }

  /**
   * Create a page in a section.
   *
   * The pages endpoint expects the raw HTML document as the request body with
   * a text/html content type. Posting a JSON envelope is rejected with 400,
   * and the title has to be carried in the document's <title> element.
   */
  async createOnenoteePage(sectionId, title, htmlContent) {
    try {
      const response = await this.apiCall(
        'POST',
        `/me/onenote/sections/${sectionId}/pages`,
        htmlContent,
        0,
        { contentType: 'text/html' }
      );
      return response;
    } catch (error) {
      throw new Error(`Failed to create OneNote page: ${error.message}`);
    }
  }

  /**
   * Update a OneNote page
   */
  async updateOnenotePage(pageId, htmlContent) {
    try {
      await this.apiCall('PATCH', `/me/onenote/pages/${pageId}/content`, [
        {
          target: 'body',
          action: 'replace',
          content: htmlContent
        }
      ]);
      return true;
    } catch (error) {
      throw new Error(`Failed to update OneNote page: ${error.message}`);
    }
  }

  /**
   * Get calendar events for a date range
   */
  async getCalendarEvents(startTime, endTime) {
    // Format times for OData query
    const start = new Date(startTime).toISOString();
    const end = new Date(endTime).toISOString();

    // Use calendarview for better recurrence handling. The id is required so
    // synced entries can be matched to their source event.
    const response = await this.apiCall('GET',
      `/me/calendarview?startDateTime=${start}&endDateTime=${end}` +
      '&$select=id,subject,start,end,isReminderOn,isAllDay,recurrence,categories,location,showAs,isCancelled' +
      '&$orderby=start/dateTime&$top=250'
    );

    return response.value || [];
  }

  /**
   * Get user profile info
   */
  async getUserInfo() {
    try {
      const response = await this.apiCall('GET', '/me?$select=displayName,mail,userPrincipalName');
      return response;
    } catch (error) {
      throw new Error(`Failed to fetch user info: ${error.message}`);
    }
  }

  /**
   * Probe what the signed-in account can actually reach.
   *
   * /me succeeds even for a licence-less guest, so a successful sign-in is not
   * proof that OneNote will work. Probing it surfaces the real blocker at
   * connect time rather than at first use.
   */
  async getCapabilities() {
    const probe = async (path) => {
      try {
        await this.apiCall('GET', path);
        return { available: true, reason: null };
      } catch (error) {
        return { available: false, reason: error.message };
      }
    };

    const onenote = await probe('/me/onenote/notebooks?$top=1');
    return { onenote };
  }

  /**
   * Test connectivity
   */
  async testConnection() {
    try {
      const user = await this.getUserInfo();
      return {
        success: true,
        user: user.displayName || user.userPrincipalName
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

// Export singleton instance
export const graphClient = new GraphClient();

/**
 * Export client class for testing
 */
export { GraphClient };
