/**
 * TimeLogger Backend Server
 * Express.js server running setup wizard API and tool endpoints
 */

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { router as setupRoutes } from './api/setup-routes.js';
import { apiLimiter } from './api/rate-limit.js';
import { tools, executeTool } from './index.js';

// Setup file logging
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logDir = path.resolve(process.env.LOCALAPPDATA || 'C:\\Temp', 'TimeLogger');
const logFile = path.join(logDir, 'backend_output.log');

// Create log directory if it doesn't exist
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logStream = fs.createWriteStream(logFile, { flags: 'a' });
logStream.on('error', error => {
  console.error('Backend log file unavailable:', error.message);
});

// Log function that writes to both console and a non-blocking file stream.
function log(msg) {
  const timestamp = new Date().toISOString();
  const fullMsg = `[${timestamp}] ${msg}`;
  console.log(fullMsg);
  logStream.write(fullMsg + '\n');
}

log('🚀 TimeLogger Backend Starting...')

const app = express();

// Fixed port by default because the packaged frontend targets 127.0.0.1:3001.
// The override exists so a test instance can run alongside the real app
// without either one having to be shut down.
const PORT = Number(process.env.TIMELOGGER_PORT) || 3001;

// The packaged Tauri webview uses a tauri.localhost origin rather than the
// Vite dev server origin, so both must be accepted.
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://tauri.localhost',
  'https://tauri.localhost',
  'tauri://localhost',
];

const corsOptions = {
  origin(origin, callback) {
    // Requests without an Origin header (same-origin, curl, Tauri Rust client).
    if (!origin) return callback(null, true);
    return callback(null, ALLOWED_ORIGINS.includes(origin));
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
};

app.use(cors(corsOptions));
app.use(express.json());

// Bound how fast any local process can drive the API. Applied before the
// routes so every handler below inherits it.
app.use('/api', apiLimiter);

// Handle preflight requests
app.options('*', cors(corsOptions));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    tools: tools.length,
  });
});

// List all available tools
app.get('/api/tools', (req, res) => {
  const toolList = tools.map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
  
  res.json({
    success: true,
    tools: toolList,
    total: toolList.length,
  });
});

// Execute a tool
app.post('/api/execute', async (req, res) => {
  try {
    const { toolName, args } = req.body;

    if (!toolName) {
      return res.status(400).json({
        success: false,
        message: 'Tool name required',
      });
    }

    const result = await executeTool(toolName, args || {});
    
    res.json({
      success: true,
      result,
    });
  } catch (error) {
    log(`❌ Tool execution error: ${error.message}`)
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

if (setupRoutes && typeof setupRoutes === 'function') {
  app.use('/api', setupRoutes);
} else {
  console.error('❌ setupRoutes is not a valid middleware!');
}

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    message: err.message || 'Internal server error',
  });
});

// Start server (loopback only - this API handles credentials)
const server = app.listen(PORT, '127.0.0.1', () => {
  log(`\n╔════════════════════════════════════════════╗`)
  log(`║   TimeLogger Backend Server Started        ║`)
  log(`╚════════════════════════════════════════════╝`)
  log(`🚀 Server running on http://localhost:${PORT}`)
  log(`📋 Health check: GET http://localhost:${PORT}/health`)
  log(`🛠️  Tools API: GET http://localhost:${PORT}/api/tools`)
  log(`⚙️  Setup Wizard: GET http://localhost:${PORT}/api/setup/status`)
  log(`Ready for connections...`)
});

// An unhandled EADDRINUSE crashes with a raw stack trace that reaches the user
// as "backend unavailable". Report it in a form the host log can act on.
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `Port ${PORT} is already in use by another TimeLogger backend. ` +
      `Close the other instance, then restart TimeLogger.`
    );
    process.exit(3);
  }
  console.error(`Backend failed to start: ${error.message}`);
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    server.close(() => logStream.end(() => process.exit(0)));
  });
}
