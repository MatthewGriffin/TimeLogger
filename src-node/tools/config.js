/**
 * Configuration management tools.
 *
 * The frontend uses the canonical section names below. Legacy keys are read
 * during migration, while all writes use the canonical persisted keys.
 */
import { db } from '../index.js';
import { graphClient } from '../api/graph-client.js';
import { readNotificationsConfig, writeNotificationsConfig } from './reminders.js';

const SECTION_KEYS = {
  jira: ['jira_config', 'jiraConfig'],
  microsoft: ['microsoft_config', 'microsoftConfig', 'outlook_token'],
  ollama: ['ollama_config', 'ollamaConfig', 'ollama_models'],
  oneNote: ['onenote_config', 'oneNoteConfig', 'onenote_notebooks'],
  calendar: ['calendar_config', 'calendarConfig'],
  app: ['app_config', 'appConfig']
};

function readSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const values = {};
  for (const row of rows) {
    try { values[row.key] = JSON.parse(row.value); } catch { values[row.key] = row.value; }
  }
  const first = (keys) => keys.map(key => values[key]).find(value => value !== undefined) ?? null;
  const microsoft = first(['microsoft_config', 'microsoftConfig']) ||
    (values.outlook_token ? { connected: true } : null);
  const app = first(SECTION_KEYS.app) || {};
  const lunch = app.lunch || {};
  const workday = app.workday || {};
  return {
    jira: first(SECTION_KEYS.jira),
    microsoft: microsoft && microsoft.hasToken ? { connected: true } : microsoft,
    ollama: first(SECTION_KEYS.ollama),
    oneNote: first(SECTION_KEYS.oneNote),
    calendar: first(SECTION_KEYS.calendar),
    lunch: {
      enabled: lunch.enabled !== false,
      name: lunch.name || 'Lunch',
      startTime: lunch.startTime || '12:00',
      endTime: lunch.endTime || '13:00'
    },
    // All-day calendar events (holidays, leave) are logged across these hours
    // rather than midnight to midnight.
    workday: {
      startTime: workday.startTime || '09:00',
      endTime: workday.endTime || '17:00'
    },
    autoStart: Boolean(app.autoStart),
    startMinimized: Boolean(app.startMinimized),
    // Notification settings were previously rendered in the UI but never
    // persisted, so every toggle silently reset on reload.
    notifications: readNotificationsConfig(),
    lastUpdated: app.lastUpdated || new Date().toISOString()
  };
}

function write(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
    .run(key, JSON.stringify(value));
}

/**
 * Earlier builds had no "enable AI" toggle in the settings UI, so saving
 * settings silently wrote enabled:false and disabled every AI feature. Those
 * values were never a deliberate choice, so repair them once for installs that
 * have a host configured. The marker ensures a later explicit opt-out sticks.
 */
function migrateOllamaEnabled() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'ollama_config'").get();
  if (!row) return;
  let config;
  try { config = JSON.parse(row.value); } catch { return; }
  if (!config || typeof config !== 'object') return;
  if (config.enabledMigrated) return;
  config.enabledMigrated = true;
  if (config.host && !config.enabled) config.enabled = true;
  write('ollama_config', config);
}

export const tools = [
  {
    name: 'newPI',
    description: 'Create or retrieve a PI issue mapping configuration',
    parameters: {
      type: 'object',
      properties: {
        piName: { type: 'string' },
        mappings: { type: 'object' }
      },
      required: ['piName']
    },
    handler: async (args) => {
      if (!args.piName) return { success: false, message: 'piName is required' }
      const key = `pi_config_${args.piName}`
      if (args.mappings !== undefined) {
        const config = { piName: args.piName, mappings: args.mappings }
        write(key, config)
        return { success: true, piName: args.piName, config }
      }
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
      if (!row) return { success: false, message: `PI configuration not found: ${args.piName}` }
      return { success: true, piName: args.piName, config: JSON.parse(row.value) }
    }
  },
  {
    name: 'get_config',
    description: 'Retrieve current application configuration',
    parameters: {
      type: 'object',
      properties: { section: { type: 'string', enum: ['all', 'pi', 'jira', 'microsoft', 'outlook', 'onenote', 'ollama', 'calendar'] } },
      required: []
    },
    handler: async (args) => {
      try {
        migrateOllamaEnabled();
        const config = readSettings();
        const section = args.section || 'all';
        if (section !== 'all') {
          if (section === 'pi') return { success: true, config: {}, pi: null, piConfig: null, timestamp: new Date().toISOString() };
          const key = section === 'outlook' ? 'microsoft' : section === 'onenote' ? 'oneNote' : section;
          return { success: true, config: { [key]: config[key] }, [key]: config[key], timestamp: new Date().toISOString() };
        }
        return { success: true, config, ...config, timestamp: new Date().toISOString() };
      } catch (error) {
        return { success: false, message: `Configuration retrieval failed: ${error.message}` };
      }
    }
  },
  {
    name: 'update_config',
    description: 'Update application configuration settings',
    parameters: { type: 'object', properties: { config: { type: 'object' } }, required: ['config'] },
    handler: async (args) => {
      try {
        if (!args.config || typeof args.config !== 'object' || Array.isArray(args.config)) throw new Error('config must be an object');
        const current = readSettings();
        const config = { ...current, ...args.config, lastUpdated: new Date().toISOString() };
        if (Object.prototype.hasOwnProperty.call(args.config, 'jira')) write('jira_config', config.jira);
        if (Object.prototype.hasOwnProperty.call(args.config, 'microsoft')) {
          // A refresh token is issued by, and only valid for, the tenant that
          // signed the user in. Changing tenant or app registration therefore
          // invalidates it — keep it and Graph calls fail with confusing AADSTS
          // errors while the UI still claims to be connected.
          const previous = current.microsoft || {};
          const next = config.microsoft || {};
          const identityChanged =
            (previous.tenantId || '') !== (next.tenantId || '') ||
            (previous.clientId || '') !== (next.clientId || '');

          if (identityChanged) {
            // Both the access token and the refresh token are bound to the
            // previous identity. Clearing only the refresh token leaves an
            // unexpired access token that is still used until it lapses,
            // producing unrelated Graph errors instead of a sign-in prompt.
            db.prepare("DELETE FROM settings WHERE key IN ('graph_refresh_token', 'graph_access_token')").run();
            config.microsoft = { ...next, connected: false };
            graphClient.reset();
          }
          write('microsoft_config', config.microsoft);

          // `setup_complete` is a separate wizard-owned snapshot. Left stale it
          // reports the old tenant on /setup/status, and re-running the wizard
          // would save it straight back over this change.
          try {
            const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('setup_complete');
            if (row) {
              const snapshot = JSON.parse(row.value);
              snapshot.microsoft = {
                ...(snapshot.microsoft || {}),
                tenantId: config.microsoft.tenantId,
                clientId: config.microsoft.clientId
              };
              db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
                .run('setup_complete', JSON.stringify(snapshot));
            }
          } catch (snapshotError) {
            console.warn('Could not sync setup_complete snapshot:', snapshotError.message);
          }
        }
        // Persist the migration marker so an explicit opt-out is never undone
        // by migrateOllamaEnabled on the next read.
        if (Object.prototype.hasOwnProperty.call(args.config, 'ollama')) {
          write('ollama_config', { ...config.ollama, enabledMigrated: true });
        }
        if (Object.prototype.hasOwnProperty.call(args.config, 'oneNote')) write('onenote_config', config.oneNote);
        if (Object.prototype.hasOwnProperty.call(args.config, 'calendar')) write('calendar_config', config.calendar);
        if (Object.prototype.hasOwnProperty.call(args.config, 'autoStart') ||
            Object.prototype.hasOwnProperty.call(args.config, 'startMinimized') ||
            Object.prototype.hasOwnProperty.call(args.config, 'lunch') ||
            Object.prototype.hasOwnProperty.call(args.config, 'workday')) {
          write('app_config', {
            autoStart: config.autoStart,
            startMinimized: config.startMinimized,
            lunch: config.lunch,
            workday: config.workday,
            lastUpdated: config.lastUpdated
          });
        }
        if (Object.prototype.hasOwnProperty.call(args.config, 'notifications')) {
          config.notifications = writeNotificationsConfig(args.config.notifications || {});
        }
        return { success: true, config };
      } catch (error) {
        return { success: false, message: `Failed to update configuration: ${error.message}` };
      }
    }
  }
];
