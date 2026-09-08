/**
 * Validation helpers for user-supplied URLs and identifiers that end up in
 * outbound requests or in HTML.
 *
 * The setup wizard lets the user type their own Jira and Ollama endpoints, so
 * those values reach `fetch()` from the request body. Without validation that
 * is a server-side request forgery primitive: the backend would happily call
 * any scheme or host the caller names. Everything here fails closed and
 * rebuilds the URL from parsed parts rather than trusting the raw string.
 */

/** Schemes we are ever willing to call out on. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Parse a user-supplied base URL and return a safe origin to build requests
 * from, or `null` if it is unusable.
 *
 * Only the origin survives: any path, query, fragment or embedded credentials
 * are discarded, so a crafted value cannot redirect the request elsewhere or
 * smuggle an auth header.
 */
export function safeBaseUrl(input, { allowHttp = false } = {}) {
  if (typeof input !== 'string' || input.trim() === '') return null;

  let url;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
  if (url.protocol === 'http:' && !allowHttp) return null;
  // Embedded credentials would be forwarded on every request.
  if (url.username || url.password) return null;
  if (!url.hostname) return null;

  return url.origin;
}

/**
 * Validate a Jira base URL.
 *
 * Jira Cloud is always HTTPS. Allowing HTTP here would let the wizard send a
 * Basic auth header containing the API token over plaintext.
 */
export function safeJiraBaseUrl(input) {
  return safeBaseUrl(input, { allowHttp: false });
}

/**
 * Validate an Ollama host.
 *
 * Ollama is normally reached over plaintext on the loopback interface or a
 * trusted LAN box, so HTTP has to stay allowed; the origin rebuild still
 * removes any path or credential trickery.
 */
export function safeOllamaHost(input) {
  return safeBaseUrl(input, { allowHttp: true });
}

// Microsoft accepts a tenant GUID, a verified domain, or one of these aliases.
const TENANT_ALIASES = new Set(['common', 'organizations', 'consumers']);
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/**
 * Validate a tenant identifier before it is interpolated into a
 * login.microsoftonline.com URL.
 *
 * The tenant is a path segment, so an unvalidated value can climb out of the
 * path with `../` and retarget the request within (or beyond) the host.
 */
export function safeTenantId(input, fallback = 'common') {
  if (typeof input !== 'string' || input.trim() === '') return fallback;

  const tenant = input.trim();
  if (TENANT_ALIASES.has(tenant.toLowerCase())) return tenant.toLowerCase();
  if (GUID.test(tenant)) return tenant;
  if (DOMAIN.test(tenant)) return tenant;

  return null;
}

/**
 * Escape a value for interpolation into an HTML document.
 *
 * The OAuth callback renders a status page containing values that originate
 * from the query string and from upstream error bodies.
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
