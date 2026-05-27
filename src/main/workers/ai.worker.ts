import { parentPort } from 'worker_threads';
import * as fs from 'fs';
import * as path from 'path';

// Messages FROM parent TO worker
type WorkerInMessage =
  | { type: 'init'; payload: { modelCacheDir: string } }
  | { type: 'embed:text'; payload: { fileId: string; text: string } }
  | { type: 'embed:image'; payload: { fileId: string; filePath: string } }
  | { type: 'stop' };

// Messages FROM worker TO parent
type WorkerOutMessage =
  | { type: 'model:progress'; payload: { status: string; progress: number } }
  | { type: 'model:ready' }
  | { type: 'embed:result'; payload: { fileId: string; embedding: number[] } }
  | { type: 'error'; payload: { message: string; fileId?: string } };

type EmbedMessage = (WorkerInMessage & { type: 'embed:text' }) | (WorkerInMessage & { type: 'embed:image' });

interface QueueItem {
  msg: EmbedMessage;
}

type PipelineFunction = (input: string, options: object) => Promise<{ data: Float32Array }>;

let pipe: PipelineFunction | null = null;
let modelReady = false;

const SUPPORTED_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']);

const queue: QueueItem[] = [];
let processing = false;

function postMessage(msg: WorkerOutMessage): void {
  parentPort!.postMessage(msg);
}

async function processQueue(): Promise<void> {
  if (processing || !modelReady || queue.length === 0) {
    return;
  }
  processing = true;
  while (queue.length > 0) {
    const item = queue.shift()!;
    await runEmbed(item.msg);
  }
  processing = false;
}

async function runEmbed(msg: EmbedMessage): Promise<void> {
  if (!pipe) {
    postMessage({
      type: 'error',
      payload: { message: 'Model pipeline is not initialized.', fileId: msg.payload.fileId },
    });
    return;
  }

  try {
    if (msg.type === 'embed:text') {
      const { fileId, text } = msg.payload;
      const output = await pipe(text, { pooling: 'mean', normalize: true });
      const embedding = Array.from(output.data as Float32Array);
      postMessage({ type: 'embed:result', payload: { fileId, embedding } });
    } else if (msg.type === 'embed:image') {
      const { fileId, filePath } = msg.payload;
      const ext = path.extname(filePath).toLowerCase();

      if (!SUPPORTED_IMAGE_EXTS.has(ext)) {
        postMessage({
          type: 'error',
          payload: {
            message: `Unsupported image type: ${ext}. Supported: ${[...SUPPORTED_IMAGE_EXTS].join(', ')}`,
            fileId,
          },
        });
        return;
      }

      if (!fs.existsSync(filePath)) {
        postMessage({
          type: 'error',
          payload: { message: `Image file not found: ${filePath}`, fileId },
        });
        return;
      }

      const output = await pipe(filePath, { pooling: 'mean', normalize: true });
      const embedding = Array.from(output.data as Float32Array);
      postMessage({ type: 'embed:result', payload: { fileId, embedding } });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postMessage({
      type: 'error',
      payload: { message: `Embedding failed: ${message}`, fileId: msg.payload.fileId },
    });
  }
}

async function initModel(modelCacheDir: string): Promise<void> {
  try {
    // Use Function constructor so TypeScript's CJS compiler does NOT transform
    // this dynamic import into require() — @xenova/transformers is ESM-only.
    const { pipeline, env } = await (new Function('m', 'return import(m)')('@xenova/transformers') as Promise<typeof import('@xenova/transformers')>);

    env.cacheDir = modelCacheDir;
    env.localModelPath = modelCacheDir;
    env.allowRemoteModels = true;

    pipe = (await pipeline('feature-extraction', 'Xenova/clip-vit-base-patch16', {
      progress_callback: (progress: { status: string; progress?: number; name?: string }) => {
        postMessage({
          type: 'model:progress',
          payload: {
            status: progress.status,
            progress: progress.progress ?? 0,
          },
        });
      },
    })) as unknown as PipelineFunction;

    modelReady = true;
    postMessage({ type: 'model:ready' });

    // Drain any requests queued before model was ready
    processQueue();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postMessage({ type: 'error', payload: { message: `Failed to load AI model: ${message}` } });
    process.exit(1);
  }
}

parentPort!.on('message', (msg: WorkerInMessage) => {
  switch (msg.type) {
    case 'init':
      initModel(msg.payload.modelCacheDir);
      break;
    case 'embed:text':
    case 'embed:image':
      queue.push({ msg });
      processQueue();
      break;
    case 'stop':
      process.exit(0);
      break;
    default: {
      const _exhaustive: never = msg;
      postMessage({
        type: 'error',
        payload: { message: `Unknown message type received: ${JSON.stringify(_exhaustive)}` },
      });
    }
  }
});
