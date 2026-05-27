import { app, BrowserWindow, ipcMain, shell, clipboard, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { Worker } from 'worker_threads';
import { SifeDatabase, FileRecord, SqlFilter } from './db/database';
import { parseQuery } from './query/parser';

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
  db = new SifeDatabase(dbPath);
}

function startIndexerWorker(watchDir: string): void {
  if (indexerWorker) {
    indexerWorker.terminate();
    indexerWorker = null;
  }

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
      db?.upsertFile(record);
      indexStats.indexedFiles = (db?.getStats().totalFiles) ?? indexStats.indexedFiles;
      sendToRenderer('index:progress', {
        current: indexStats.progress.current,
        total: indexStats.progress.total,
        phase: 'indexing',
      });

      if (indexStats.modelStatus === 'ready' && aiWorker) {
        aiWorker.postMessage({
          type: 'embed:text',
          payload: {
            fileId: record.fileId,
            text: `${record.fileName} ${record.metadataTags}`,
          },
        });
      }
    } else if (type === 'file:delete') {
      const { filePath } = payload as { filePath: string };
      db?.deleteFile(filePath);
    } else if (type === 'progress') {
      const { current, total } = payload as { current: number; total: number };
      indexStats.progress = { current, total };
      sendToRenderer('index:progress', {
        current,
        total,
        phase: 'indexing',
      });
    } else if (type === 'ready') {
      indexStats.isIndexing = false;
      const dbStats = db?.getStats();
      indexStats.totalFiles = dbStats?.totalFiles ?? 0;
      sendToRenderer('index:status', { ...indexStats });
    }
  });

  indexerWorker.on('error', (err) => {
    console.error('[IndexerWorker] error:', err);
  });

  indexerWorker.on('exit', (code) => {
    if (code !== 0) {
      console.error(`[IndexerWorker] exited with code ${code}`);
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
      sendToRenderer('index:status', { ...indexStats });
    } else if (type === 'embed:result') {
      const { fileId, embedding } = payload as { fileId: string; embedding: number[] };
      db?.updateEmbedding(fileId, embedding);
    } else if (type === 'error') {
      console.error('[AiWorker] error:', payload);
    }
  });

  aiWorker.on('error', (err) => {
    console.error('[AiWorker] error:', err);
    indexStats.modelStatus = 'error';
  });

  aiWorker.on('exit', (code) => {
    if (code !== 0) {
      console.error(`[AiWorker] exited with code ${code}`);
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

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
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
