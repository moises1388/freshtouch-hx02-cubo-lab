// Diagnostic logging that never leaks sensitive values.
//
// Rule: any context key that looks like a secret or cardholder data field
// is masked before it reaches console output. This is a denylist-by-pattern,
// not a promise of safety for fields we haven't thought of — callers must
// still avoid passing full card numbers, CVV or PIN into `context` at all.

const SENSITIVE_KEY_PATTERN = /api[_-]?key|card|pan|cvv|pin|password|secret|token/i;

export function maskSecret(value) {
  if (!value) return '(not set)';
  const str = String(value);
  if (str.length <= 4) return '****';
  return `${'*'.repeat(Math.max(str.length - 4, 4))}${str.slice(-4)}`;
}

function sanitize(context) {
  const safe = {};
  for (const [key, value] of Object.entries(context || {})) {
    safe[key] = SENSITIVE_KEY_PATTERN.test(key) ? maskSecret(value) : value;
  }
  return safe;
}

export function log(machineId, message, context = {}) {
  const prefix = `[${machineId}] ${message}`;
  const safeContext = sanitize(context);
  const line = Object.keys(safeContext).length
    ? `${prefix} ${JSON.stringify(safeContext)}`
    : prefix;
  console.log(line);
  return line;
}
