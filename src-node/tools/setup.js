/**
 * Setup and verification tools
 * 
 * Credentials are now passed from frontend Settings.
 * No vault/SecretStore dependencies.
 */

import { makeHttpRequest } from '../api/http-client.js';
import { ollamaClient } from '../api/ollama-client.js';

/**
 * Build Basic auth header from email and API token
 */
function buildBasicAuth(email, apiToken) {
  return Buffer.from(`${email}:${apiToken}`).toString('base64');
}

export const tools = [
  {
    name: 'test_jira_connection',
    description: 'Test connection to Jira with provided credentials',
    parameters: {
      type: 'object',
      properties: {
        baseUrl: { type: 'string', description: 'Jira base URL (e.g., https://your-domain.atlassian.net)' },
        email: { type: 'string', description: 'Jira user email' },
        apiToken: { type: 'string', description: 'Jira API token' }
      },
      required: ['baseUrl', 'email', 'apiToken']
    },
    handler: async (args) => {
      console.log('🔍 test_jira_connection called with:', { 
        baseUrl: args.baseUrl, 
        email: args.email, 
        apiToken: args.apiToken ? '***' : 'MISSING' 
      });

      if (!args.baseUrl || !args.email || !args.apiToken) {
        const missing = [];
        if (!args.baseUrl) missing.push('baseUrl');
        if (!args.email) missing.push('email');
        if (!args.apiToken) missing.push('apiToken');
        
        throw new Error(`Missing: ${missing.join(', ')}`);
      }

      const b64 = buildBasicAuth(args.email, args.apiToken);
      const cleanBaseUrl = args.baseUrl.replace(/\/$/, ''); // Remove trailing slash
      const testUrl = `${cleanBaseUrl}/rest/api/3/myself`;
      
      console.log('🌐 Testing Jira connection to:', testUrl);
      
      try {
        const response = await makeHttpRequest(testUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Basic ${b64}`,
            'Content-Type': 'application/json'
          },
          timeoutMs: 10000
        });
        
        console.log('✅ Jira connection successful!');
        console.log('   Status:', response.status);
        console.log('   User:', response.data?.displayName);
        console.log('   Email:', response.data?.emailAddress);
        
        if (!response.data?.accountId) {
          throw new Error('Invalid Jira response: missing accountId');
        }
        
        return {
          success: true,
          message: `✅ Connected as ${response.data?.displayName} (${response.data?.emailAddress || args.email})`
        };
      } catch (error) {
        console.error('❌ Jira connection failed');
        console.error('   Error:', error.message);
        
        // Provide helpful hints based on error type
        let hint = '';
        if (error.message.includes('HTTP 401')) {
          hint = ' - Check your email and API token';
        } else if (error.message.includes('HTTP 404')) {
          hint = ' - Check your Jira base URL (should be https://your-domain.atlassian.net)';
        } else if (error.message.includes('ENOTFOUND') || error.message.includes('getaddrinfo')) {
          hint = ' - Network error: cannot reach Jira. Check URL and internet connection';
        } else if (error.message.includes('timeout')) {
          hint = ' - Connection timeout: Jira is not responding';
        }
        
        throw new Error(`Jira connection failed: ${error.message}${hint}`);
      }
    }
  },
  {
    name: 'test_ollama_connection',
    description: 'Test connection to local Ollama instance and verify LLM availability',
    parameters: {
      type: 'object',
      properties: {
        host: { type: 'string', description: 'Ollama host URL (e.g., http://localhost:11434)' }
      },
      required: ['host']
    },
    handler: async (args) => {
      try {
        const host = args.host || 'http://localhost:11434';
        
        // Test connection to Ollama
        const response = await makeHttpRequest(`${host}/api/tags`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        if (response.data?.models && Array.isArray(response.data.models)) {
          return {
            success: true,
            message: `✅ Ollama connected (${response.data.models.length} models available)`,
            models: response.data.models.map((m) => m.name || m),
            timestamp: new Date().toISOString()
          };
        } else {
          return {
            success: false,
            message: '❌ Ollama not responding correctly',
            error: 'No models returned',
            timestamp: new Date().toISOString()
          };
        }
      } catch (error) {
        return {
          success: false,
          message: `Ollama connection test failed: ${error.message}`,
          error: error.message,
          timestamp: new Date().toISOString()
        };
      }
    }
  },
];
