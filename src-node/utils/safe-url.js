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

// Hostnames that resolve inside the machine or the local network. A public
// service must never be reachable at one of these: allowing it turns an
// outbound request into a probe of whatever the host can see.
const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '[::1]']);
const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^192\.168\./,
  /^169\.254\./, // link-local, covers cloud metadata at 169.254.169.254
  /^172\.(1[6-9]|2\d|3[01])\./,
];

/**
 * Whether a hostname points somewhere inside the machine or private network.
 */
export function isPrivateHost(hostname) {
  const host = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  if (LOOPBACK_NAMES.has(host)) return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (PRIVATE_V4.some((range) => range.test(host))) return true;
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)) return true;
  return false;
}

/**
 * Parse a user-supplied base URL and return a safe origin to build requests
 * from, or `null` if it is unusable.
 *
 * Only the origin survives: any path, query, fragment or embedded credentials
 * are discarded, so a crafted value cannot redirect the request elsewhere or
 * smuggle an auth header.
 */
export function safeBaseUrl(input, { allowHttp = false, allowPrivateHosts = true } = {}) {
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
  if (!allowPrivateHosts && isPrivateHost(url.hostname)) return null;

  return url.origin;
}

/**
 * Validate a Jira base URL.
 *
 * Jira Cloud is always HTTPS and always public. Allowing HTTP would leak the
 * API token in the Basic auth header, and allowing a private address would let
 * this route be used to probe the local network.
 */
export function safeJiraBaseUrl(input) {
  return safeBaseUrl(input, { allowHttp: false, allowPrivateHosts: false });
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
 * Build a URL on the Microsoft identity platform for a given tenant.
 *
 * The host is fixed here and the tenant is inserted as an encoded single path
 * segment, so no caller can move the request off login.microsoftonline.com.
 */
export function microsoftAuthorityUrl(tenantId, endpointPath) {
  const tenant = safeTenantId(tenantId, 'common');
  if (!tenant) return null;
  return `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/${endpointPath}`;
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
