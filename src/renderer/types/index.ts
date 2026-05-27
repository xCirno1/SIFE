export interface FileRecord {
  fileId: string;
  fileName: string;
  filePath: string;
  metadataTags: string;
  vectorEmbedding?: number[];
  hasEmbedding?: boolean;
  lastModifiedUtc: number;
}

export interface IndexStats {
  totalFiles: number;
  indexedFiles: number;
  isIndexing: boolean;
  progress: { current: number; total: number };
  modelStatus: 'loading' | 'ready' | 'error';
}
