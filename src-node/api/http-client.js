/** Shared Axios transport for backend integrations. */
import axios from 'axios';

export const httpClient = axios.create({
  headers: { 'User-Agent': 'TimeLogger-App/1.0' },
  // Match the old native client and avoid forwarding credentials on redirects.
  maxRedirects: 0
});

/** Preserve the legacy makeHttpRequest response and error contract. */
export async function makeHttpRequest(url, options = {}) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('Invalid URL'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported URL protocol: ${parsed.protocol}`);
  }
  const timeout = options.timeoutMs || 30000;
  try {
    const response = await httpClient.request({
      url: parsed.toString(),
      method: options.method || 'GET',
      headers: options.headers,
      data: options.body,
      timeout,
      responseType: 'text',
      transformResponse: [parseJSON]
    });
    return { status: response.status, data: response.data, headers: response.headers };
  } catch (error) {
    if (error.response) {
      const body = error.response.data;
      throw new Error(`HTTP ${error.response.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    }
    if (error.code === 'ECONNABORTED') throw new Error(`Request timeout after ${timeout}ms`);
    throw error;
  }
}

function parseJSON(data) {
  if (!data || typeof data !== 'string') return data;
  try { return JSON.parse(data); } catch { return data; }
}
