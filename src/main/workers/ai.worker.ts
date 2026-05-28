import { parentPort } from 'worker_threads';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Message contracts
// ---------------------------------------------------------------------------

type WorkerInMessage =
  | { type: 'init'; payload: { modelCacheDir: string } }
  | { type: 'embed:text'; payload: { fileId: string; text: string } }
  | { type: 'embed:image'; payload: { fileId: string; filePath: string } }
  | { type: 'embed:file'; payload: { fileId: string; filePath: string } }
  | { type: 'stop' };

type WorkerOutMessage =
  | { type: 'model:progress'; payload: { status: string; progress: number } }
  | { type: 'model:ready' }
  | { type: 'embed:result'; payload: { fileId: string; embedding: number[] } }
  | { type: 'queue:update'; payload: { size: number; processing: boolean; current: string; items: string[] } }
  | { type: 'error'; payload: { message: string; fileId?: string } };

type EmbedMessage =
  | (WorkerInMessage & { type: 'embed:text' })
  | (WorkerInMessage & { type: 'embed:image' })
  | (WorkerInMessage & { type: 'embed:file' });

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const MODEL_ID = 'Xenova/clip-vit-base-patch16';
const SUPPORTED_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']);
const QUEUE_ITEMS_PREVIEW_LIMIT = 100;
const QUEUE_UPDATE_THROTTLE_MS = 200;

// Content embedding constants
const TEXT_CHUNK_CHARS = 300;  // ~77 tokens; fits CLIP's hard 77-token cap

const queue: EmbedMessage[] = [];
let processing = false;
let modelReady = false;
let lastQueueUpdateAt = 0;
let queueUpdateTimer: NodeJS.Timeout | null = null;

// CLIP components — typed as unknown to avoid import() type conflicts in CJS
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let textTokenizer: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let textModel: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let imageProcessor: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let imageModel: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RawImageCls: any = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function post(msg: WorkerOutMessage): void {
  parentPort!.postMessage(msg);
}

function queueLabel(m: EmbedMessage): string {
  return m.type === 'embed:text'
    ? m.payload.text.slice(0, 60)
    : path.basename(m.payload.filePath);
}

function postQueueUpdate(current = '', force = false): void {
  const now = Date.now();
  if (!force && now - lastQueueUpdateAt < QUEUE_UPDATE_THROTTLE_MS) {
    if (!queueUpdateTimer) {
      queueUpdateTimer = setTimeout(() => {
        queueUpdateTimer = null;
        postQueueUpdate(current, true);
      }, QUEUE_UPDATE_THROTTLE_MS);
    }
    return;
  }

  lastQueueUpdateAt = now;
  const items = queue.slice(0, QUEUE_ITEMS_PREVIEW_LIMIT).map(queueLabel);
  post({ type: 'queue:update', payload: { size: queue.length, processing, current, items } });
}

// ---------------------------------------------------------------------------
// Content-embedding helpers
// ---------------------------------------------------------------------------

/** Returns true if the first `len` bytes of `buf` contain a null byte (binary indicator). */
function isBinaryBuffer(buf: Buffer, len: number): boolean {
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/** L2-normalize a Float32Array into a plain number[]. */
function l2Normalize(data: Float32Array): number[] {
  let sumSq = 0;
  for (const v of data) sumSq += v * v;
  const norm = Math.sqrt(sumSq) + 1e-8;
  const result = new Array<number>(data.length);
  for (let i = 0; i < data.length; i++) result[i] = data[i] / norm;
  return result;
}

/** Convert a Windows absolute path to a URL-safe file:// URL for RawImage.fromURL fallback. */
function toFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const withPrefix = normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
  return encodeURI(withPrefix);
}

// ---------------------------------------------------------------------------
// Embed execution
// ---------------------------------------------------------------------------

async function runEmbed(msg: EmbedMessage): Promise<void> {
  try {
    if (msg.type === 'embed:text') {
      // Query embedding — plain text, no file I/O.
      const { fileId, text } = msg.payload;
      const inputs = textTokenizer([text], { padding: true, truncation: true });
      const { text_embeds } = await textModel(inputs);
      const embedding = l2Normalize(text_embeds.data as Float32Array);
      post({ type: 'embed:result', payload: { fileId, embedding } });

    } else if (msg.type === 'embed:file') {
      // File embedding — route by type; read actual content for text/code files.
      const { fileId, filePath } = msg.payload;

      if (!fs.existsSync(filePath)) {
        post({ type: 'error', payload: { message: `File not found: ${filePath}`, fileId } });
        return;
      }

      const ext = path.extname(filePath).toLowerCase();

      if (SUPPORTED_IMAGE_EXTS.has(ext)) {
        // ── Vision path: decode pixels → CLIP vision encoder ──────────────────
        let image: any;
        if (typeof RawImageCls?.read === 'function') {
          image = await RawImageCls.read(filePath);
        } else {
          image = await RawImageCls.fromURL(toFileUrl(filePath));
        }
        const inputs = await imageProcessor(image);
        const { image_embeds } = await imageModel(inputs);
        const embedding = l2Normalize(image_embeds.data as Float32Array);
        post({ type: 'embed:result', payload: { fileId, embedding } });

      } else {
        // ── Text/code path: read first 300 chars → single CLIP text embed ──────
        // Binary detection: check first 512 bytes for null bytes.
        const headerBuf = Buffer.alloc(512);
        const fd = fs.openSync(filePath, 'r');
        const bytesRead = fs.readSync(fd, headerBuf, 0, 512, 0);
        fs.closeSync(fd);
        if (isBinaryBuffer(headerBuf, bytesRead)) {
          // Binary non-image (exe, dll, zip…) — skip silently.
          return;
        }

        // Read only the first TEXT_CHUNK_CHARS characters — fits in CLIP's 77-token window.
        const buf = Buffer.alloc(TEXT_CHUNK_CHARS);
        const fd2 = fs.openSync(filePath, 'r');
        const read = fs.readSync(fd2, buf, 0, TEXT_CHUNK_CHARS, 0);
        fs.closeSync(fd2);
        const snippet = buf.slice(0, read).toString('utf-8');

        const inputs = textTokenizer([snippet], { padding: true, truncation: true, max_length: 77 });
        const { text_embeds } = await textModel(inputs);
        const embedding = l2Normalize(text_embeds.data as Float32Array);
        post({ type: 'embed:result', payload: { fileId, embedding } });
      }

    } else {
      // Legacy embed:image (kept for backward compat, but embed:file is preferred)
      const { fileId, filePath } = msg.payload;
      const ext = path.extname(filePath).toLowerCase();
      if (!SUPPORTED_IMAGE_EXTS.has(ext)) {
        post({ type: 'error', payload: { message: `Unsupported image type: ${ext}`, fileId } });
        return;
      }
      if (!fs.existsSync(filePath)) {
        post({ type: 'error', payload: { message: `Image not found: ${filePath}`, fileId } });
        return;
      }
      let image: any;
      if (typeof RawImageCls?.read === 'function') {
        image = await RawImageCls.read(filePath);
      } else {
        image = await RawImageCls.fromURL(toFileUrl(filePath));
      }
      const inputs = await imageProcessor(image);
      const { image_embeds } = await imageModel(inputs);
      const embedding = l2Normalize(image_embeds.data as Float32Array);
      post({ type: 'embed:result', payload: { fileId, embedding } });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    post({
      type: 'error',
      payload: { message: `Embedding failed: ${message}`, fileId: msg.payload.fileId },
    });
  }
}

async function processQueue(): Promise<void> {
  if (processing || !modelReady || queue.length === 0) return;
  processing = true;
  postQueueUpdate('', true);

  while (queue.length > 0) {
    const msg = queue.shift()!;
    const label = msg.type === 'embed:text' ? msg.payload.text.slice(0, 50) : path.basename(msg.payload.filePath);
    postQueueUpdate(label);
    await runEmbed(msg);
  }

  processing = false;
  postQueueUpdate('', true);
}

// ---------------------------------------------------------------------------
// Model init — CLIP text encoder + CLIP vision encoder.
// Both produce 512-dim L2-normalised embeddings in the same vector space,
// enabling cross-modal text ↔ image similarity search.
// ---------------------------------------------------------------------------

async function initModel(modelCacheDir: string): Promise<void> {
  try {
    // Dynamic import via Function constructor — prevents TypeScript's CJS
    // output from transforming import() into require() for ESM-only packages.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transformers = await (new Function('m', 'return import(m)')('@xenova/transformers') as Promise<any>);

    const {
      AutoTokenizer,
      CLIPTextModelWithProjection,
      AutoProcessor,
      CLIPVisionModelWithProjection,
      RawImage,
      env,
    } = transformers;

    env.cacheDir = modelCacheDir;
    env.localModelPath = modelCacheDir;
    env.allowRemoteModels = true;

    const progressCallback = (p: { status: string; progress?: number }) => {
      post({ type: 'model:progress', payload: { status: p.status, progress: p.progress ?? 0 } });
    };

    post({ type: 'model:progress', payload: { status: 'Loading text encoder…', progress: 0 } });
    textTokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
    textModel = await CLIPTextModelWithProjection.from_pretrained(MODEL_ID, {
      progress_callback: progressCallback,
    });

    post({ type: 'model:progress', payload: { status: 'Loading vision encoder…', progress: 0 } });
    imageProcessor = await AutoProcessor.from_pretrained(MODEL_ID);
    imageModel = await CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, {
      progress_callback: progressCallback,
    });

    RawImageCls = RawImage;
    modelReady = true;
    post({ type: 'model:ready' });
    processQueue();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    post({ type: 'error', payload: { message: `Failed to load CLIP model: ${message}` } });
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

parentPort!.on('message', (msg: WorkerInMessage) => {
  switch (msg.type) {
    case 'init':
      initModel(msg.payload.modelCacheDir);
      break;
    case 'embed:text':
    case 'embed:image':
    case 'embed:file':
      // Query embeds should jump ahead of bulk indexing to avoid search timeouts.
      if (msg.type === 'embed:text' && msg.payload.fileId.startsWith('__query__')) {
        queue.unshift(msg);
      } else {
        queue.push(msg);
      }
      postQueueUpdate();
      processQueue();
      break;
    case 'stop':
      process.exit(0);
      break;
    default: {
      const _exhaustive: never = msg;
      post({
        type: 'error',
        payload: { message: `Unknown message type: ${JSON.stringify(_exhaustive)}` },
      });
    }
  }
});
