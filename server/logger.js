const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');
const MAX_LINES = 10000;

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function append(level, msg) {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}\n`;
  fs.appendFile(LOG_FILE, line, () => {});
}

function info(msg) { append('INFO', msg); }
function warn(msg) { append('WARN', msg); }
function error(msg) { append('ERROR', msg); }

function readLast(lines = 100) {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    const content = fs.readFileSync(LOG_FILE, 'utf-8');
    const all = content.split('\n').filter(Boolean);
    const totalLines = all.length;

    if (totalLines > MAX_LINES) {
      const trimmed = all.slice(totalLines - MAX_LINES);
      fs.writeFileSync(LOG_FILE, trimmed.join('\n') + '\n');
      return trimmed.slice(-lines);
    }

    return all.slice(-lines);
  } catch {
    return [];
  }
}

module.exports = { info, warn, error, readLast };
