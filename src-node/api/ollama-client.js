/**
 * Ollama API Client
 * 
 * Connects to local Ollama instance for LLM features.
 * Supports model querying, streaming responses, and graceful degradation.
 */

import axios from 'axios';
import { db } from '../index.js';

const OLLAMA_BASE_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const REQUEST_TIMEOUT = 60000; // 60 seconds for LLM responses
const DEFAULT_MODEL = 'llama3.2:1b'; // Fallback model

/**
 * The model the app is tuned for: small enough to sit entirely in a laptop
 * GPU's spare VRAM, which keeps categorisation off the CPU and out of the
 * user's way. Offered on first run when it is missing, never forced.
 */
export const RECOMMENDED_MODEL = 'llama3.2:1b';
export const RECOMMENDED_MODEL_SIZE = '1.3 GB';

/**
 * Context size is the lever that decides whether a model runs entirely on the
 * GPU. Ollama sizes the KV cache from it, and on a 4GB laptop card a large
 * default (32k) pushes the cache past the free VRAM, so Ollama silently
 * splits the model and runs most of it on the CPU - exactly the contention
 * that must not interrupt the user's other work. Our prompts are short, so a
 * small window costs nothing and keeps inference wholly on the GPU.
 */
const DEFAULT_NUM_CTX = 4096;

/**
 * Read the Ollama settings saved by the setup wizard / Settings page.
 */
function readOllamaConfig() {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('ollama_config');
    if (!row?.value) return null;
    return JSON.parse(row.value);
  } catch (error) {
    console.error('Failed to read Ollama config:', error.message);
    return null;
  }
}

/**
 * Ollama reports models as objects ({ name, size, ... }). Normalise to tags so
 * callers can match on strings without tripping over the object shape.
 */
function toModelName(model) {
  if (typeof model === 'string') return model;
  return model?.name || model?.model || '';
}

/**
 * OllamaClient - Manages LLM API calls via local Ollama
 */
class OllamaClient {
  constructor() {
    this.baseUrl = OLLAMA_BASE_URL;
    this.available = false;
    this.availableModels = [];
    this.defaultModel = DEFAULT_MODEL;
    this.configuredModel = null;
    this.options = { num_ctx: DEFAULT_NUM_CTX };
  }

  /**
   * Apply the saved host/model settings. Without this the client always talked
   * to localhost and ignored the model the user picked in Settings.
   */
  loadConfig() {
    const config = readOllamaConfig();
    if (!config) return;

    if (config.host) this.baseUrl = String(config.host).replace(/\/+$/, '');
    if (config.model) this.configuredModel = config.model;

    const options = { num_ctx: DEFAULT_NUM_CTX };
    if (typeof config.temperature === 'number') options.temperature = config.temperature;
    if (typeof config.maxTokens === 'number') options.num_predict = config.maxTokens;
    if (typeof config.numCtx === 'number') options.num_ctx = config.numCtx;
    this.options = options;
  }

  /**
   * Initialize and check Ollama availability
   */
  async initialize() {
    try {
      this.loadConfig();
      await this.checkAvailability();
      if (this.available) {
        await this.listModels();
        console.log(`✅ Ollama available with ${this.availableModels.length} model(s)`);
      }
      return this.available;
    } catch (error) {
      console.warn(`⚠️ Ollama not available: ${error.message}`);
      this.available = false;
      return false;
    }
  }

  /**
   * Check if Ollama is running
   */
  async checkAvailability() {
    try {
      const response = await axios.get(`${this.baseUrl}/api/tags`, {
        timeout: 5000
      });
      this.available = response.status === 200;
      return this.available;
    } catch (error) {
      this.available = false;
      throw new Error('Ollama not running or unreachable');
    }
  }

  /**
   * Get list of available models
   */
  async listModels() {
    try {
      const response = await axios.get(`${this.baseUrl}/api/tags`, {
        timeout: 5000
      });
      this.availableModels = (response.data.models || []).map(toModelName).filter(Boolean);
      return this.availableModels;
    } catch (error) {
      throw new Error(`Failed to list models: ${error.message}`);
    }
  }

  /**
   * Get a suitable model for the task.
   *
   * Returns an installed tag (e.g. "llama2:latest"), never a bare preference
   * name, so Ollama cannot 404 on a model that is not actually installed.
   */
  getAvailableModel() {
    if (!this.available || this.availableModels.length === 0) {
      return null;
    }

    // An exact tag wins over a family match, so "llama3.2:1b" is not
    // satisfied by a larger "llama3.2:3b" that happens to be installed first.
    const matches = (candidate) =>
      this.availableModels.find(name => name === candidate) ||
      this.availableModels.find(
        name => name.split(':')[0] === String(candidate).split(':')[0]
      );

    // The model chosen in Settings wins, provided it is still installed.
    if (this.configuredModel) {
      const configured = matches(this.configuredModel);
      if (configured) return configured;
    }

    // Prefer small models. On a 4GB laptop GPU only a small model fits
    // entirely in VRAM, and one that fits is both far faster and, more
    // importantly, leaves the CPU free for the user's real work. A bigger
    // model is not worth it here: Ollama splits it across CPU and GPU and
    // every request then competes with whatever else is running.
    const modelPreference = [
      'llama3.2:1b',
      'llama3.2',
      'qwen2.5:1.5b',
      'phi3:mini',
      'orca-mini',
      'mistral',
      'neural-chat',
      'llama2'
    ];

    for (const preferred of modelPreference) {
      const found = matches(preferred);
      if (found) return found;
    }

    // Return first available model
    return this.availableModels[0] || this.defaultModel;
  }

  /**
   * Generate text response
   */
  /**
   * Generate text response.
   *
   * `options.timeoutMs` overrides the default request timeout for callers
   * that must not block the user - it is applied to the HTTP request rather
   * than being forwarded to Ollama as a generation parameter.
   */
  async generate(prompt, model = null, options = {}) {
    if (!this.available) {
      throw new Error('Ollama not available. Start Ollama and try again.');
    }

    const selectedModel = model || this.getAvailableModel();
    if (!selectedModel) {
      throw new Error('No LLM models available in Ollama');
    }

    const { timeoutMs, ...bodyOptions } = options;

    try {
      const response = await axios.post(
        `${this.baseUrl}/api/generate`,
        {
          model: selectedModel,
          prompt: prompt,
          stream: false,
          options: { ...this.options, ...(bodyOptions.options || {}) },
          ...Object.fromEntries(Object.entries(bodyOptions).filter(([k]) => k !== 'options'))
        },
        {
          timeout: typeof timeoutMs === 'number' ? timeoutMs : REQUEST_TIMEOUT,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      return {
        success: true,
        response: response.data.response,
        model: selectedModel,
        done: response.data.done,
        totalDuration: response.data.total_duration,
        loadDuration: response.data.load_duration,
        promptEvalDuration: response.data.prompt_eval_duration,
        evalDuration: response.data.eval_duration
      };
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        throw new Error('Cannot connect to Ollama. Is it running? (ollama serve)');
      }
      throw new Error(`LLM generation failed: ${error.message}`);
    }
  }

  /**
   * Categorize text into predefined categories
   */
  async categorizeText(text, categories = []) {
    if (!this.available) {
      return { error: 'Ollama not available' };
    }

    const categoryList = categories.length > 0 
      ? categories.join(', ')
      : 'Development, Meetings, Documentation, Review, Testing, Deployment, Other';

    const prompt = `Categorize this text into ONE of these categories: ${categoryList}

Text: "${text}"

Return ONLY the category name, nothing else.`;

    try {
      const result = await this.generate(prompt);
      const category = result.response.trim().split('\n')[0].trim();
      return {
        success: true,
        category,
        model: result.model
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        fallback: 'Other'
      };
    }
  }

  /**
   * Generate summary of text
   */
  async summarizeText(text, maxLength = 100) {
    if (!this.available) {
      return { error: 'Ollama not available' };
    }

    const prompt = `Summarize this text in ${maxLength} characters or less:

${text}

Provide a concise summary.`;

    try {
      const result = await this.generate(prompt);
      return {
        success: true,
        summary: result.response.trim(),
        model: result.model,
        originalLength: text.length,
        summaryLength: result.response.trim().length
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        original: text
      };
    }
  }

  /**
   * Test LLM functionality
   */
  async testLLM() {
    try {
      const isAvailable = await this.checkAvailability();
      if (!isAvailable) {
        return {
          available: false,
          message: 'Ollama not running. Start with: ollama serve'
        };
      }

      const models = await this.listModels();
      const model = this.getAvailableModel();

      // Test with simple prompt
      const result = await this.generate('Say hello briefly.');

      return {
        available: true,
        models: models,
        selectedModel: model,
        testResponse: result.response.substring(0, 100) + '...',
        performanceMs: result.totalDuration / 1000000
      };
    } catch (error) {
      return {
        available: false,
        error: error.message
      };
    }
  }

  /**
   * Whether the recommended model is already installed.
   */
  hasRecommendedModel() {
    return this.availableModels.some(
      name => name === RECOMMENDED_MODEL || name.split(':')[0] === RECOMMENDED_MODEL.split(':')[0]
    );
  }

  /**
   * Download a model, reporting progress as it goes.
   *
   * Ollama streams newline-delimited JSON for pulls, so the response is read
   * as a stream rather than buffered - a multi-hundred-megabyte download
   * would otherwise report nothing until it finished. No timeout is set
   * because a download legitimately takes minutes; the caller controls
   * cancellation instead.
   */
  async pullModel(model, onProgress) {
    const response = await axios.post(
      `${this.baseUrl}/api/pull`,
      { model, stream: true },
      { responseType: 'stream', timeout: 0 }
    );

    let buffer = '';
    let lastStatus = '';

    await new Promise((resolve, reject) => {
      response.data.on('data', (chunk) => {
        buffer += chunk.toString();
        // The final line of a chunk is often a partial record, so keep it
        // back and let the next chunk complete it.
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const update = JSON.parse(line);
            if (update.error) {
              reject(new Error(update.error));
              return;
            }
            lastStatus = update.status || lastStatus;
            if (typeof onProgress === 'function') {
              onProgress({
                status: lastStatus,
                completed: update.completed || 0,
                total: update.total || 0
              });
            }
          } catch {
            // A malformed line is not worth failing the whole download over.
          }
        }
      });
      response.data.on('end', resolve);
      response.data.on('error', reject);
    });

    // Refresh the cache so the new model is selectable straight away.
    await this.listModels();
    return { success: true, model };
  }

  /**
   * Get model information
   */
  getModelInfo() {
    return {
      available: this.available,
      models: this.availableModels.map(m => m.name),
      defaultModel: this.getAvailableModel(),
      baseUrl: this.baseUrl,
      timeout: REQUEST_TIMEOUT
    };
  }
}

// Export singleton instance
export const ollamaClient = new OllamaClient();

/**
 * Export client class for testing
 */
export { OllamaClient };
