/**
 * Daily Summary Tempo - Node.js Backend
 * 
 * This module exports all tools from the extension and provides
 * an IPC handler system for Tauri communication.
 */

import { APP_DATA_DIR, db } from './db.js';

export { db };

// Import all tool modules
import * as JiraTempo from './tools/jira-tempo.js';
import * as DailySummary from './tools/daily-summary.js';
import * as Notes from './tools/notes.js';
import * as OneNote from './tools/onenote.js';
import * as Outlook from './tools/outlook.js';
import * as Config from './tools/config.js';
import * as Sprint from './tools/sprint.js';
import * as Scrum from './tools/scrum.js';
import * as Setup from './tools/setup.js';
import * as AiModel from './tools/ai-model.js';
import * as Reminders from './tools/reminders.js';
import * as DataManagement from './tools/data-management.js';

// Register all tools
export const tools = [
  // Setup & Verification
  ...Setup.tools,
  
  // Jira/Tempo
  ...JiraTempo.tools,
  
  // Current Sprint / PI meeting mappings
  ...Sprint.tools,
  
  // Daily Summary
  ...DailySummary.tools,
  
  // Notes
  ...Notes.tools,
  
  // Daily scrum report
  ...Scrum.tools,
  
  // OneNote
  ...OneNote.tools,
  
  // Outlook
  ...Outlook.tools,
  
  // Config
  ...Config.tools,
  
  // Local AI model setup
  ...AiModel.tools,

  // Notification reminders
  ...Reminders.tools,

  // Backup, restore and reset
  ...DataManagement.tools,
];

/**
 * Execute a tool by name with arguments
 * @param {string} toolName - The name of the tool to execute
 * @param {object} args - Arguments for the tool
 * @param {object} context - Invocation context (sessionId, toolCallId, etc)
 * @returns {Promise<string|object>} Tool result
 */
export async function executeTool(toolName, args, context = {}) {
  const tool = tools.find(t => t.name === toolName);
  
  if (!tool) {
    throw new Error(`Tool "${toolName}" not found`);
  }
  
  try {
    const result = await tool.handler(args, context);
    return result;
  } catch (error) {
    return {
      textResultForLlm: error.message,
      resultType: 'failure'
    };
  }
}

/**
 * Get all available tools (for discovery)
 */
export function getToolsMetadata() {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

/**
 * Health check
 */
export function healthCheck() {
  try {
    // Test database
    const result = db.prepare('SELECT 1').get();
    return {
      status: 'ok',
      database: 'connected',
      appDataDir: APP_DATA_DIR,
    };
  } catch (error) {
    return {
      status: 'error',
      error: error.message,
    };
  }
}

export default {
  executeTool,
  getToolsMetadata,
  healthCheck,
  db,
};
