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

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logStream = fs.createWriteStream(logFile, { flags: 'a' });
logStream.on('error', error => {
  console.error('Backend log file unavailable:', error.message);
});

function log(msg) {
  const timestamp = new Date().toISOString();
  const fullMsg = `[${timestamp}] ${msg}`;
  console.log(fullMsg);
  logStream.write(fullMsg + '\n');
}

log('🚀 TimeLogger Backend Starting...');

const app = express();
const PORT = Number(process.env.TIMELOGGER_PORT) || 3001;

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
    if (!origin) return callback(null, true);
    return callback(null, ALLOWED_ORIGINS.includes(origin));
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
};

app.use(cors(corsOptions));
app.use(express.json());
app.use('/api', apiLimiter);
app.options('*', cors(corsOptions));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    tools: tools.length,
  });
});

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

    // Tool handlers historically returned structured failures instead of
    // throwing. Preserve their useful message, but do not wrap them in a
    // success:true envelope: the frontend would otherwise treat them as data.
    if (result && typeof result === 'object' &&
        (result.resultType === 'failure' || result.success === false)) {
      const message = result.message || result.textResultForLlm || 'Tool execution failed';
      return res.status(500).json({ success: false, message });
    }

    return res.json({ success: true, result });
  } catch (error) {
    log(`❌ Tool execution error: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
    });
  }
});

if (setupRoutes && typeof setupRoutes === 'function') {
  app.use('/api', setupRoutes);
} else {
  console.error('❌ setupRoutes is not a valid middleware!');
}

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    message: err.message || 'Internal server error',
  });
});

const server = app.listen(PORT, '127.0.0.1', () => {
  log('\n╔════════════════════════════════════════════╗');
  log('║   TimeLogger Backend Server Started        ║');
  log('╚════════════════════════════════════════════╝');
  log(`🚀 Server running on http://localhost:${PORT}`);
  log(`📋 Health check: GET http://localhost:${PORT}/health`);
  log(`🛠️  Tools API: GET http://localhost:${PORT}/api/tools`);
  log(`⚙️  Setup Wizard: GET http://localhost:${PORT}/api/setup/status`);
  log('Ready for connections...');
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `Port ${PORT} is already in use by another TimeLogger backend. ` +
      'Close the other instance, then restart TimeLogger.'
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
