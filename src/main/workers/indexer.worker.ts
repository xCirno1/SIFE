import { parentPort } from 'worker_threads';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import Database from 'better-sqlite3';
import chokidar, { FSWatcher } from 'chokidar';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileRecord {
  fileId: string;
  fileName: string;
  filePath: string;
  metadataTags: string;
  vectorEmbedding?: number[];
  lastModifiedUtc: number;
}

type WorkerInMessage =
  | { type: 'start'; payload: { watchDir: string; dbPath: string } }
  | { type: 'stop' };

type WorkerOutMessage =
  | { type: 'file:upsert'; payload: FileRecord }
  | { type: 'file:delete'; payload: { filePath: string } }
  | { type: 'progress'; payload: { current: number; total: number; phase: 'reconcile' | 'watch' } }
  | { type: 'ready' }
  | { type: 'error'; payload: { message: string } };

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let watcher: FSWatcher | null = null;
let readDb: InstanceType<typeof Database> | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function post(msg: WorkerOutMessage): void {
  parentPort!.postMessage(msg);
}

function generateFileId(filePath: string): string {
  return crypto.createHash('sha256').update(filePath).digest('hex').slice(0, 16);
}

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico']);
const VIDEO_EXTS = new Set(['mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'flac', 'ogg', 'aac', 'wma']);
const DOCUMENT_EXTS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt']);
const CODE_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'cpp', 'c', 'h', 'cs', 'php', 'rb', 'swift']);
const TEXT_EXTS = new Set(['txt', 'md', 'json', 'xml', 'yaml', 'yml', 'toml', 'csv', 'log']);
const ARCHIVE_EXTS = new Set(['zip', 'tar', 'gz', '7z', 'rar']);

function classifyExtension(ext: string): string {
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (DOCUMENT_EXTS.has(ext)) return 'document';
  if (CODE_EXTS.has(ext)) return 'code';
  if (TEXT_EXTS.has(ext)) return 'text';
  if (ARCHIVE_EXTS.has(ext)) return 'archive';
  return 'other';
}

function extractMetadataTags(filePath: string, stats: fs.Stats): string {
  const ext = path.extname(filePath).replace('.', '').toLowerCase();
  const sizeBytes = stats.size;
  const sizeKB = Math.round(sizeBytes / 1024);
  const modifiedDate = new Date(stats.mtimeMs).toISOString().slice(0, 10);
  const type = classifyExtension(ext);
  const dir = path.basename(path.dirname(filePath));

  const parts: string[] = [];
  if (ext) parts.push(`Ext:${ext}`);
  parts.push(`Size:${sizeBytes}`);
  parts.push(`SizeKB:${sizeKB}`);
  parts.push(`Modified:${modifiedDate}`);
  parts.push(`Type:${type}`);
  if (dir) parts.push(`Dir:${dir}`);

  return parts.join(';');
}

function buildFileRecord(filePath: string, stats: fs.Stats): FileRecord {
  return {
    fileId: generateFileId(filePath),
    fileName: path.basename(filePath),
    filePath,
    metadataTags: extractMetadataTags(filePath, stats),
    lastModifiedUtc: Math.round(stats.mtimeMs),
  };
}

// ---------------------------------------------------------------------------
// Concurrency Limiter
// ---------------------------------------------------------------------------

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const i = nextIndex++;
      results[i] = await tasks[i]();
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(limit, tasks.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Recursive directory walk (Node 18+ uses recursive option, older fallback)
// ---------------------------------------------------------------------------

async function walkDir(dir: string): Promise<string[]> {
  const files: string[] = [];

  async function recurse(current: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      return; // skip unreadable directories
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // skip hidden
      if (entry.name === 'node_modules') continue;

      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await recurse(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  await recurse(dir);
  return files;
}

// ---------------------------------------------------------------------------
// Delta Reconciler
// ---------------------------------------------------------------------------

async function reconcile(watchDir: string, db: InstanceType<typeof Database>): Promise<void> {
  // Query existing records from DB (read-only connection)
  const storedRows = db
    .prepare<string[]>('SELECT filePath, lastModifiedUtc FROM files WHERE filePath LIKE ? || \'%\'')
    .all(watchDir) as { filePath: string; lastModifiedUtc: number }[];

  const storedMap = new Map<string, number>();
  for (const row of storedRows) {
    storedMap.set(row.filePath, row.lastModifiedUtc);
  }

  // Walk disk
  const diskFiles = await walkDir(watchDir);
  const diskSet = new Set<string>(diskFiles);

  // Find files to upsert (new or changed)
  const toUpsert: string[] = [];
  for (const filePath of diskFiles) {
    let stats: fs.Stats;
    try {
      stats = await fs.promises.stat(filePath);
    } catch {
      continue; // file disappeared between walk and stat
    }

    const storedMtime = storedMap.get(filePath);
    if (storedMtime === undefined || storedMtime !== Math.round(stats.mtimeMs)) {
      toUpsert.push(filePath);
    }
  }

  // Find deleted files (in DB but not on disk)
  for (const storedPath of storedMap.keys()) {
    if (!diskSet.has(storedPath)) {
      post({ type: 'file:delete', payload: { filePath: storedPath } });
    }
  }

  // Process upserts with concurrency limit
  let processed = 0;
  const total = toUpsert.length;

  const tasks = toUpsert.map((filePath) => async () => {
    try {
      const stats = await fs.promises.stat(filePath);
      const record = buildFileRecord(filePath, stats);
      post({ type: 'file:upsert', payload: record });
    } catch {
      // File may have been deleted after walk; skip silently
    }

    processed++;
    if (processed % 10 === 0 || processed === total) {
      post({ type: 'progress', payload: { current: processed, total, phase: 'reconcile' } });
    }
  });

  if (tasks.length > 0) {
    await runWithConcurrency(tasks, 5);
  }
}

// ---------------------------------------------------------------------------
// Chokidar Watcher
// ---------------------------------------------------------------------------

function startWatcher(watchDir: string): void {
  watcher = chokidar.watch(watchDir, {
    ignored: /(^|[/\\])\../,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100,
    },
  });

  watcher.on('add', async (filePath: string) => {
    try {
      const stats = await fs.promises.stat(filePath);
      const record = buildFileRecord(filePath, stats);
      post({ type: 'file:upsert', payload: record });
      post({ type: 'progress', payload: { current: 1, total: 1, phase: 'watch' } });
    } catch (err) {
      post({ type: 'error', payload: { message: `Failed to index added file ${filePath}: ${(err as Error).message}` } });
    }
  });

  watcher.on('change', async (filePath: string) => {
    try {
      const stats = await fs.promises.stat(filePath);
      const record = buildFileRecord(filePath, stats);
      post({ type: 'file:upsert', payload: record });
      post({ type: 'progress', payload: { current: 1, total: 1, phase: 'watch' } });
    } catch (err) {
      post({ type: 'error', payload: { message: `Failed to index changed file ${filePath}: ${(err as Error).message}` } });
    }
  });

  watcher.on('unlink', (filePath: string) => {
    post({ type: 'file:delete', payload: { filePath } });
  });

  watcher.on('error', (err: Error) => {
    post({ type: 'error', payload: { message: `Watcher error: ${err.message}` } });
  });
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

async function shutdown(): Promise<void> {
  if (watcher) {
    await watcher.close();
    watcher = null;
  }
  if (readDb) {
    readDb.close();
    readDb = null;
  }
}

// ---------------------------------------------------------------------------
// Message Handler
// ---------------------------------------------------------------------------

if (!parentPort) {
  throw new Error('indexer.worker must be run as a worker_thread');
}

parentPort.on('message', (msg: WorkerInMessage) => {
  if (msg.type === 'start') {
    const { watchDir, dbPath } = msg.payload;

    (async () => {
      try {
        // Open a read-only DB connection for reconciliation queries
        readDb = new Database(dbPath, { readonly: true, fileMustExist: false });
        readDb.pragma('journal_mode=WAL');

        // Run delta reconciliation
        await reconcile(watchDir, readDb);

        // Close read-only connection — parent handles all writes
        readDb.close();
        readDb = null;

        // Start the live file watcher
        startWatcher(watchDir);

        post({ type: 'ready' });
      } catch (err) {
        post({ type: 'error', payload: { message: `Indexer startup failed: ${(err as Error).message}` } });
      }
    })();
  } else if (msg.type === 'stop') {
    shutdown()
      .catch((err: Error) => {
        post({ type: 'error', payload: { message: `Shutdown error: ${err.message}` } });
      })
      .finally(() => {
        process.exit(0);
      });
  }
});
