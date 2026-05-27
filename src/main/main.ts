import { app, BrowserWindow, ipcMain, shell, clipboard, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { Worker } from 'worker_threads';
import { SifeDatabase, FileRecord, SqlFilter } from './db/database';
import { parseQuery } from './query/parser';
import { initLogger, log, getLogBuffer, getLogFilePath } from './logger';

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let db: SifeDatabase | null = null;
let indexerWorker: Worker | null = null;
let aiWorker: Worker | null = null;
let currentWatchDir = '';
let indexStats = {
  totalFiles: 0,
  indexedFiles: 0,
  isIndexing: false,
  progress: { current: 0, total: 0 },
  modelStatus: 'loading' as 'loading' | 'ready' | 'error',
};

function sendToRenderer(channel: string, data: unknown): void {
  if (mainWindow && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    show: false,
    backgroundColor: '#09090b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function initDatabase(): void {
  const dbPath = path.join(app.getPath('userData'), 'sife.db');
  try {
    db = new SifeDatabase(dbPath);
    log('INFO', 'DB', `Database opened at ${dbPath}`);
  } catch (err) {
    log('ERROR', 'DB', `Failed to open database: ${(err as Error).message}`);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Upsert batch — collects records and flushes via a single DB transaction
// to avoid blocking the main thread on every individual file event.
// ---------------------------------------------------------------------------
const UPSERT_BATCH_SIZE = 100;
const UPSERT_FLUSH_INTERVAL_MS = 250;

let upsertBatch: FileRecord[] = [];
let upsertFlushTimer: ReturnType<typeof setTimeout> | null = null;

function flushUpsertBatch(): void {
  if (upsertFlushTimer !== null) {
    clearTimeout(upsertFlushTimer);
    upsertFlushTimer = null;
  }
  if (upsertBatch.length === 0 || !db) return;

  const toFlush = upsertBatch;
  upsertBatch = [];

  try {
    db.batchUpsert(toFlush);
  } catch (err) {
    log('ERROR', 'IndexerWorker', `batchUpsert failed: ${(err as Error).message}`);
  }

  indexStats.indexedFiles = db.getStats().totalFiles;
  sendToRenderer('index:progress', {
    current: indexStats.progress.current,
    total: indexStats.progress.total,
    phase: 'indexing',
  });

  if (indexStats.modelStatus === 'ready' && aiWorker) {
    for (const record of toFlush) {
      aiWorker.postMessage({
        type: 'embed:text',
        payload: { fileId: record.fileId, text: `${record.fileName} ${record.metadataTags}` },
      });
    }
  }
}

function scheduleUpsertFlush(): void {
  if (upsertBatch.length >= UPSERT_BATCH_SIZE) {
    flushUpsertBatch();
  } else if (upsertFlushTimer === null) {
    upsertFlushTimer = setTimeout(flushUpsertBatch, UPSERT_FLUSH_INTERVAL_MS);
  }
}

// Throttle progress IPC to at most once per 200 ms
let lastProgressSentAt = 0;
function sendProgressThrottled(current: number, total: number): void {
  const now = Date.now();
  if (now - lastProgressSentAt >= 200) {
    lastProgressSentAt = now;
    sendToRenderer('index:progress', { current, total, phase: 'indexing' });
  }
}

function startIndexerWorker(watchDir: string): void {
  if (indexerWorker) {
    indexerWorker.terminate();
    indexerWorker = null;
  }

  // Reset batch state for a fresh indexing run
  upsertBatch = [];
  if (upsertFlushTimer !== null) {
    clearTimeout(upsertFlushTimer);
    upsertFlushTimer = null;
  }
  lastProgressSentAt = 0;

  const workerPath = path.join(__dirname, 'workers', 'indexer.worker.js');
  indexerWorker = new Worker(workerPath);

  indexStats.isIndexing = true;

  indexerWorker.postMessage({
    type: 'start',
    payload: {
      watchDir,
      dbPath: path.join(app.getPath('userData'), 'sife.db'),
    },
  });

  indexerWorker.on('message', (msg: { type: string; payload: Record<string, unknown> }) => {
    const { type, payload } = msg;

    if (type === 'file:upsert') {
      const record = payload as unknown as FileRecord;
      upsertBatch.push(record);
      scheduleUpsertFlush();
    } else if (type === 'file:delete') {
      const { filePath } = payload as { filePath: string };
      db?.deleteFile(filePath);
    } else if (type === 'progress') {
      const { current, total } = payload as { current: number; total: number };
      indexStats.progress = { current, total };
      sendProgressThrottled(current, total);
    } else if (type === 'ready') {
      // Flush any remaining buffered records before marking ready
      flushUpsertBatch();
      indexStats.isIndexing = false;
      const dbStats = db?.getStats();
      indexStats.totalFiles = dbStats?.totalFiles ?? 0;
      log('INFO', 'IndexerWorker', `Ready — ${indexStats.totalFiles} files indexed`);
      sendToRenderer('index:status', { ...indexStats });
    } else if (type === 'error') {
      const { message } = payload as { message: string };
      log('ERROR', 'IndexerWorker', message);
      sendToRenderer('sife:log', { level: 'ERROR', source: 'IndexerWorker', message });
    }
  });

  indexerWorker.on('error', (err) => {
    log('ERROR', 'IndexerWorker', `Worker thread error: ${err.message}`);
    sendToRenderer('sife:log', { level: 'ERROR', source: 'IndexerWorker', message: err.message });
  });

  indexerWorker.on('exit', (code) => {
    if (code !== 0) {
      log('ERROR', 'IndexerWorker', `Exited with code ${code}`);
      sendToRenderer('sife:log', { level: 'ERROR', source: 'IndexerWorker', message: `Worker exited with code ${code}` });
    } else {
      log('INFO', 'IndexerWorker', 'Worker exited cleanly');
    }
    indexerWorker = null;
  });
}

function startAiWorker(): void {
  const workerPath = path.join(__dirname, 'workers', 'ai.worker.js');
  aiWorker = new Worker(workerPath);

  aiWorker.postMessage({
    type: 'init',
    payload: {
      modelCacheDir: path.join(app.getPath('userData'), 'models'),
    },
  });

  aiWorker.on('message', (msg: { type: string; payload: Record<string, unknown> }) => {
    const { type, payload } = msg;

    if (type === 'model:progress') {
      sendToRenderer('ai:progress', payload);
    } else if (type === 'model:ready') {
      indexStats.modelStatus = 'ready';
      log('INFO', 'AiWorker', 'Model ready');
      sendToRenderer('index:status', { ...indexStats });
    } else if (type === 'embed:result') {
      const { fileId, embedding } = payload as { fileId: string; embedding: number[] };
      try {
        db?.updateEmbedding(fileId, embedding);
      } catch (err) {
        log('ERROR', 'AiWorker', `updateEmbedding failed for ${fileId}: ${(err as Error).message}`);
      }
    } else if (type === 'error') {
      const { message } = payload as { message: string };
      log('ERROR', 'AiWorker', message);
      sendToRenderer('sife:log', { level: 'ERROR', source: 'AiWorker', message });
    }
  });

  aiWorker.on('error', (err) => {
    log('ERROR', 'AiWorker', `Worker thread error: ${err.message}`);
    indexStats.modelStatus = 'error';
    sendToRenderer('sife:log', { level: 'ERROR', source: 'AiWorker', message: err.message });
  });

  aiWorker.on('exit', (code) => {
    if (code !== 0) {
      log('ERROR', 'AiWorker', `Exited with code ${code}`);
    }
    aiWorker = null;
  });
}

// ---------------------------------------------------------------------------
// IPC Handlers
// ---------------------------------------------------------------------------

ipcMain.handle('sife:search', async (_event, query: string): Promise<FileRecord[]> => {
  if (!db) return [];

  if (!query || !query.trim()) {
    return db.getAllFiles().slice(0, 500);
  }

  const { sqlFilters, semanticQuery } = parseQuery(query);
  const resultMap = new Map<string, FileRecord>();

  if (sqlFilters.length > 0) {
    const filterResults = db.applyFilters(sqlFilters as SqlFilter[], 200);
    for (const r of filterResults) {
      resultMap.set(r.fileId, r);
    }
  }

  // Only run FTS on the semantic (non-filter) portion — never on the raw query
  // which may contain "key:value" tokens that FTS5 misinterprets as column filters.
  const ftsText = semanticQuery.trim();
  if (ftsText) {
    const ftsResults = db.searchByFTS(ftsText, 200);
    for (const r of ftsResults) {
      if (!resultMap.has(r.fileId)) {
        resultMap.set(r.fileId, r);
      }
    }
  }

  const combined = Array.from(resultMap.values()).slice(0, 500);
  return combined;
});

ipcMain.handle('sife:getStats', async () => {
  const dbStats = db?.getStats() ?? { totalFiles: 0, filesWithEmbeddings: 0 };
  return {
    ...indexStats,
    totalFiles: dbStats.totalFiles,
  };
});

ipcMain.handle('sife:setWatchDir', async (_event, dir: string): Promise<{ success: boolean; error?: string }> => {
  if (!dir || typeof dir !== 'string') {
    return { success: false, error: 'Invalid directory path.' };
  }

  const resolved = path.resolve(dir);
  if (!fs.existsSync(resolved)) {
    return { success: false, error: 'Directory does not exist.' };
  }

  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    return { success: false, error: 'Path is not a directory.' };
  }

  currentWatchDir = resolved;
  startIndexerWorker(resolved);

  // Persist config
  const configPath = path.join(app.getPath('userData'), 'config.json');
  try {
    fs.writeFileSync(configPath, JSON.stringify({ watchDir: currentWatchDir }), 'utf-8');
  } catch (err) {
    console.error('[Config] Failed to write config:', err);
  }

  return { success: true };
});

ipcMain.handle('sife:getWatchDir', async () => currentWatchDir);

ipcMain.handle('sife:openFile', async (_event, filePath: string): Promise<void> => {
  if (!filePath || typeof filePath !== 'string') return;
  const resolved = path.resolve(filePath);
  if (!path.isAbsolute(resolved) || resolved.includes('..')) return;
  await shell.openPath(resolved);
});

ipcMain.handle('sife:copyPath', async (_event, filePath: string): Promise<void> => {
  if (!filePath || typeof filePath !== 'string') return;
  const resolved = path.resolve(filePath);
  if (!path.isAbsolute(resolved) || resolved.includes('..')) return;
  clipboard.writeText(resolved);
});

ipcMain.handle('sife:selectDirectory', async (): Promise<string | null> => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('sife:getLogs', async (): Promise<{ lines: string[]; filePath: string }> => {
  return { lines: getLogBuffer(), filePath: getLogFilePath() };
});

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  initLogger(app.getPath('userData'));
  log('INFO', 'App', `SIFE starting — userData: ${app.getPath('userData')}`);
  initDatabase();
  createWindow();
  startAiWorker();

  const configPath = path.join(app.getPath('userData'), 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as { watchDir?: string };
      if (config.watchDir && fs.existsSync(config.watchDir)) {
        currentWatchDir = config.watchDir;
        startIndexerWorker(config.watchDir);
      }
    } catch (err) {
      console.error('[Config] Failed to read config:', err);
    }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  indexerWorker?.terminate();
  aiWorker?.terminate();
  db?.close();

  const configPath = path.join(app.getPath('userData'), 'config.json');
  try {
    fs.writeFileSync(configPath, JSON.stringify({ watchDir: currentWatchDir }), 'utf-8');
  } catch (err) {
    console.error('[Config] Failed to write config on quit:', err);
  }
});
