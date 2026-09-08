/**
 * HTTP Client utility for making API requests
 */

import http from 'http';
import https from 'https';

export async function makeHttpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(url);
      
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        reject(new Error(`Unsupported URL protocol: ${parsed.protocol}`));
        return;
      }

      const transport = parsed.protocol === 'https:' ? https : http;
      
      const reqOptions = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: options.method || 'GET',
        headers: {
          'User-Agent': 'TimeLogger-App/1.0',
          ...options.headers
        }
      };

      const request = transport.request(reqOptions, (response) => {
        let data = '';

        response.on('data', (chunk) => {
          data += chunk;
        });

        response.on('end', () => {
          try {
            const parsedData = parseJSON(data);
            
            if (response.statusCode >= 200 && response.statusCode < 300) {
              resolve({
                status: response.statusCode,
                data: parsedData,
                headers: response.headers
              });
            } else {
              reject(new Error(`HTTP ${response.statusCode}: ${typeof parsedData === 'string' ? parsedData : JSON.stringify(parsedData)}`));
            }
          } catch (error) {
            reject(error);
          }
        });
      });

      request.on('error', reject);
      
      request.setTimeout(options.timeoutMs || 30000, () => {
        request.destroy(new Error(`Request timeout after ${options.timeoutMs || 30000}ms`));
      });

      // Send body if provided
      if (options.body) {
        if (typeof options.body === 'string') {
          request.write(options.body);
        } else {
          request.write(JSON.stringify(options.body));
        }
      }

      request.end();
    } catch (error) {
      reject(error);
    }
  });
}

function parseJSON(data) {
  if (!data || typeof data !== 'string') {
    return data;
  }
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}
