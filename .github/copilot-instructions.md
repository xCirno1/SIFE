# SIFE — Project Guidelines

## Project Overview

**SIFE (Smart Indexing File Engine)** is a local, offline-first, high-performance hybrid file indexing and semantic search engine for Windows built on **Electron + TypeScript + Vite + React + Tailwind CSS**. It uses a strict multi-threaded architecture: the Renderer and Main processes are kept lightweight, and all heavy work (file watching, vector embedding, database I/O) runs inside Node `worker_threads`.

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop Runtime | Electron (TypeScript) |
| Frontend | Vite + React + Tailwind CSS |
| Database | LanceDB (embedded vector store) or `node:sqlite` with FTS5 |
| File Watching | `chokidar` inside a dedicated worker thread |
| AI Inference | `Transformers.js` + quantized CLIP model (`Xenova/clip-vit-base-patch16`) |
| IPC Bridge | Electron `contextBridge` + `ipcRenderer.invoke` — `nodeIntegration: false`, `contextIsolation: true` |

## Architecture Rules (Non-Negotiable)

- **No heavy work in Main or Renderer.** All CPU-intensive tasks (directory walks, tensor math, DB writes) must run inside `worker_threads`.
- **IPC payloads must stay tiny.** Never pass binary blobs, raw pixel buffers, or large arrays over IPC. Pass file paths, metadata strings, and lightweight result arrays only.
- **Security bridge is mandatory.** The `preload.ts` must use `contextBridge.exposeInMainWorld` to expose a typed `sifeEngine` API. Never expose raw `ipcRenderer` to the Renderer.
- **Ingestion throttling.** The file watcher worker must batch-process files (e.g., 5 per batch) to avoid I/O saturation. Pause AI inference while the user is actively typing in the omnibar.

## Core Data Model

```typescript
interface FileRecord {
  fileId: string;       // Unique Windows NTFS reference key
  fileName: string;
  filePath: string;
  metadataTags: string; // "Key:Value;Key:Value" parsed schema string
  vectorEmbedding?: number[]; // Float32 array for semantic search
  lastModifiedUtc: number;
}
```

## UI Design System

| Token | Value | Tailwind |
|---|---|---|
| Background | `#09090b` | `zinc-950` |
| Surface | `#18181b` | `zinc-900` |
| Border | `#27272a` | `zinc-800` |
| Text Primary | `#fafafa` | `zinc-50` |
| Text Secondary | `#a1a1aa` | `zinc-400` |
| Accent | `#3b82f6` | `blue-500` |
| AI Accent | `#a855f7` | `purple-500` |

- Every interactive/clickable element **must** have `cursor-pointer`.
- The omnibar is a persistent global command-palette input. Attribute tokens like `Type:png` must render as visual pill chips inside the input.
- Results use virtualized scrolling for performance with thousands of files.
- Reuse existing components from `src/renderer/components/ui/` before creating new ones.

## Implementation Steps (Ordered)

1. **Base Electron + Vite + React + Tailwind setup** with secure `preload.ts` bridge.
2. **Database schema** — LanceDB or `node:sqlite` with FTS5; implement `FileRecord` CRUD in a worker.
3. **Multi-threaded ingestion pipeline** — `chokidar` in worker, batch throttle, basic tag extraction.
4. **Hybrid query engine** — tokenize omnibar input into SQL filters + semantic vector query; target <5 ms latency.
5. **Offline AI integration** — `Transformers.js` CLIP model in worker for embedding generation.
6. **UI polish** — virtualized list, fade-in previews, side inspector panel, omnibar pill chips.

## Code Quality

- Write production-grade code at all times — no stubs, no placeholder logic, no `TODO` comments left in final output.
- Implement proper error handling everywhere; never swallow exceptions silently.
- Keep code clean and readable: clear naming, minimal nesting, single-responsibility functions.
- Avoid dead code, unused imports, and unnecessary complexity.

## Security

- Never hard-code credentials, API keys, tokens, or connection strings.
- All environment-specific values must come from `.env` files (never committed).
- Validate and sanitize all external inputs at system boundaries.
- `nodeIntegration` must be `false`; `contextIsolation` must be `true` in every `BrowserWindow`.
- Follow OWASP Top 10; flag and fix insecure patterns immediately.

## Post-Code Verification

After completing any code changes, always run the following checks before considering the task done:

```bash
# TypeScript type-check
npx tsc --noEmit

# Lint
npm run lint

# Build (Electron + Vite)
npm run build
```

Fix all errors and type failures before marking work as complete.

## Environment Configuration

- Use `.env` files for all environment-specific configuration (e.g., default watch directory, batch size, model path).

## Other

- Never manually write dependencies into `package.json`. Install via CLI (`npm install <pkg>`).
- Always commit changes to GitHub after each feature implementation, fix, or update.
- Always use the **orchestrator** agent to start a new implementation.
