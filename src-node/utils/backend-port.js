/**
 * Resolve the backend port consistently across the Node server and OAuth redirect.
 * Invalid values fall back to the application default instead of making the
 * Node process and native Rust client disagree about where the sidecar listens.
 */
export function backendPort(env = process.env) {
  const raw = env.TIMELOGGER_PORT;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return 3001;
  const port = Number(raw);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 3001;
}
