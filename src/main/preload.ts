import { contextBridge, ipcRenderer } from 'electron';

export interface IndexStats {
  totalFiles: number;
  indexedFiles: number;
  isIndexing: boolean;
  progress: { current: number; total: number };
  modelStatus: 'loading' | 'ready' | 'error';
}

export interface FileRecord {
  fileId: string;
  fileName: string;
  filePath: string;
  metadataTags: string;
  vectorEmbedding?: number[];
  hasEmbedding?: boolean;
  lastModifiedUtc: number;
}

type ProgressCallback = (data: { current: number; total: number; phase: string }) => void;
type StatusCallback = (data: IndexStats) => void;
type AiProgressCallback = (data: { status: string; progress: number }) => void;
type LogCallback = (data: { level: string; source: string; message: string }) => void;
type AiQueueCallback = (data: { size: number; processing: boolean; current: string; items: string[] }) => void;

const sifeEngine = {
  search: (query: string): Promise<FileRecord[]> =>
    ipcRenderer.invoke('sife:search', query),

  getStats: (): Promise<IndexStats> =>
    ipcRenderer.invoke('sife:getStats'),

  setWatchDir: (dir: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('sife:setWatchDir', dir),

  getWatchDir: (): Promise<string> =>
    ipcRenderer.invoke('sife:getWatchDir'),

  openFile: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('sife:openFile', filePath),

  copyPath: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('sife:copyPath', filePath),

  selectDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke('sife:selectDirectory'),

  onIndexProgress: (cb: ProgressCallback): void => {
    ipcRenderer.on('index:progress', (_event, data) => cb(data));
  },

  onIndexStatus: (cb: StatusCallback): void => {
    ipcRenderer.on('index:status', (_event, data) => cb(data));
  },

  onAiProgress: (cb: AiProgressCallback): void => {
    ipcRenderer.on('ai:progress', (_event, data) => cb(data));
  },

  removeAllListeners: (channel: string): void => {
    ipcRenderer.removeAllListeners(channel);
  },

  getLogs: (): Promise<{ lines: string[]; filePath: string }> =>
    ipcRenderer.invoke('sife:getLogs'),

  onLog: (cb: LogCallback): void => {
    ipcRenderer.on('sife:log', (_event, data) => cb(data));
  },

  onAiQueue: (cb: AiQueueCallback): void => {
    ipcRenderer.on('ai:queue', (_event, data) => cb(data));
  },

  windowMinimize: (): void => ipcRenderer.send('window:minimize'),
  windowMaximize: (): void => ipcRenderer.send('window:maximize'),
  windowClose: (): void => ipcRenderer.send('window:close'),
};

contextBridge.exposeInMainWorld('sifeEngine', sifeEngine);
