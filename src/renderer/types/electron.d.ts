export {};

declare global {
  interface Window {
    sifeEngine: {
      search: (query: string) => Promise<FileRecord[]>;
      getStats: () => Promise<IndexStats>;
      setWatchDir: (dir: string) => Promise<{ success: boolean; error?: string }>;
      getWatchDir: () => Promise<string>;
      openFile: (filePath: string) => Promise<void>;
      copyPath: (filePath: string) => Promise<void>;
      selectDirectory: () => Promise<string | null>;
      onIndexProgress: (cb: ProgressCallback) => void;
      onIndexStatus: (cb: StatusCallback) => void;
      onAiProgress: (cb: AiProgressCallback) => void;
      removeAllListeners: (channel: string) => void;
      getLogs: () => Promise<{ lines: string[]; filePath: string }>;
      onLog: (cb: LogCallback) => void;
      windowMinimize: () => void;
      windowMaximize: () => void;
      windowClose: () => void;
    };
  }

  interface FileRecord {
    fileId: string;
    fileName: string;
    filePath: string;
    metadataTags: string;
    vectorEmbedding?: number[];
    hasEmbedding?: boolean;
    lastModifiedUtc: number;
  }

  interface IndexStats {
    totalFiles: number;
    indexedFiles: number;
    isIndexing: boolean;
    progress: { current: number; total: number };
    modelStatus: 'loading' | 'ready' | 'error';
  }

  type ProgressCallback = (data: { current: number; total: number; phase: string }) => void;
  type StatusCallback = (data: IndexStats) => void;
  type AiProgressCallback = (data: { status: string; progress: number }) => void;
  type LogCallback = (data: { level: string; source: string; message: string }) => void;
}
