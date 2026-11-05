/**
 * Points the suite at a throwaway data folder. This must be the first import in
 * the test suite, because db.js opens the database as soon as it is loaded.
 *
 * The default location is the user's real TimeLogger database, which the tests
 * write to: running them there overwrites real settings, and any real entry for
 * tomorrow makes the future-meetings test fail.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timelogger-test-'));
process.env.TIMELOGGER_DATA_DIR = dataDir;

process.on('exit', () => {
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // SQLite may still hold the file on Windows; the OS temp folder is fine.
  }
});
