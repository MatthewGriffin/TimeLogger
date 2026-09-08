/**
 * AI model setup
 *
 * The app is tuned around a small model that fits entirely in a laptop GPU's
 * spare VRAM. A fresh install will not have it, so on first run we check for
 * it and offer to download it - an offer, never an automatic download, since
 * it is over a gigabyte and the user may be tethered or short on disk.
 *
 * Everything here is deliberately non-blocking: the download runs in the
 * background and progress is polled, so AI setup can never hold up the app.
 */

import { db } from '../index.js';
import { ollamaClient, RECOMMENDED_MODEL, RECOMMENDED_MODEL_SIZE } from '../api/ollama-client.js';

const DISMISSED_KEY = 'ai_model_prompt_dismissed';

/**
 * Progress for the in-flight download. Held in memory rather than the
 * database because it is worthless after a restart - an interrupted download
 * simply gets offered again.
 */
let pullState = { status: 'idle', completed: 0, total: 0, model: null, error: null };

function readDismissed() {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(DISMISSED_KEY);
    return row?.value === 'true';
  } catch {
    return false;
  }
}

function writeDismissed(dismissed) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(DISMISSED_KEY, dismissed ? 'true' : 'false');
}

export const tools = [
  {
    name: 'get_ai_model_status',
    description: 'Check whether the recommended local AI model is installed and whether the user should be offered it',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
      const available = await ollamaClient.initialize();
      if (!available) {
        // Ollama being absent is not a problem to nag about - AI features
        // already degrade gracefully without it.
        return {
          success: true,
          ollamaAvailable: false,
          shouldOffer: false,
          recommendedModel: RECOMMENDED_MODEL
        };
      }

      const hasRecommended = ollamaClient.hasRecommendedModel();
      const installedModels = ollamaClient.availableModels;
      const dismissed = readDismissed();

      return {
        success: true,
        ollamaAvailable: true,
        hasRecommended,
        installedModels,
        activeModel: ollamaClient.getAvailableModel(),
        recommendedModel: RECOMMENDED_MODEL,
        recommendedSize: RECOMMENDED_MODEL_SIZE,
        // Only worth offering when it is missing, the user has not already
        // said no, and a download is not already running.
        shouldOffer: !hasRecommended && !dismissed && pullState.status !== 'downloading',
        pullStatus: pullState.status
      };
    }
  },
  {
    name: 'install_recommended_model',
    description: 'Start downloading the recommended local AI model in the background',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
      if (pullState.status === 'downloading') {
        return { success: true, alreadyRunning: true, model: pullState.model };
      }

      const available = await ollamaClient.initialize();
      if (!available) {
        return { success: false, message: 'Ollama is not running, so the model cannot be downloaded.' };
      }

      pullState = { status: 'downloading', completed: 0, total: 0, model: RECOMMENDED_MODEL, error: null };

      // Intentionally not awaited: the download takes minutes and the caller
      // must return immediately so the UI stays responsive.
      ollamaClient
        .pullModel(RECOMMENDED_MODEL, (progress) => {
          pullState = { ...pullState, ...progress, status: 'downloading' };
        })
        .then(() => {
          pullState = { ...pullState, status: 'complete', error: null };
          // Downloading it is consent enough; never offer it again.
          writeDismissed(true);
        })
        .catch((error) => {
          pullState = { ...pullState, status: 'error', error: error.message };
        });

      return { success: true, started: true, model: RECOMMENDED_MODEL };
    }
  },
  {
    name: 'get_model_download_progress',
    description: 'Poll the progress of the background model download',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
      const { status, completed, total, model, error } = pullState;
      const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
      return { success: true, status, percent, completed, total, model, error };
    }
  },
  {
    name: 'dismiss_model_recommendation',
    description: 'Record that the user declined the recommended model so they are not asked again',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
      writeDismissed(true);
      return { success: true };
    }
  }
];
