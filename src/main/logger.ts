import * as fs from 'fs';
import * as path from 'path';

let logFilePath = '';
let buffer: string[] = [];
const MAX_BUFFER = 500; // keep last 500 lines in memory

export function initLogger(userDataDir: string): void {
  logFilePath = path.join(userDataDir, 'sife-debug.log');
  // Truncate log on startup so it doesn't grow unbounded
  try {
    fs.writeFileSync(logFilePath, `--- SIFE Debug Log — ${new Date().toISOString()} ---\n`);
  } catch {
    // If we can't write the log file, just buffer in memory
  }
}

export function log(level: 'INFO' | 'WARN' | 'ERROR', source: string, message: string): void {
  const line = `[${new Date().toISOString()}] [${level}] [${source}] ${message}`;

  // Console
  if (level === 'ERROR') {
    console.error(line);
  } else {
    console.log(line);
  }

  // In-memory ring buffer
  buffer.push(line);
  if (buffer.length > MAX_BUFFER) buffer.shift();

  // File
  if (logFilePath) {
    try {
      fs.appendFileSync(logFilePath, line + '\n');
    } catch {
      // Non-fatal
    }
  }
}

export function getLogBuffer(): string[] {
  return [...buffer];
}

export function getLogFilePath(): string {
  return logFilePath;
}
