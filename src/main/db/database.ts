import Database from 'better-sqlite3';
import type { Database as DatabaseType, Statement } from 'better-sqlite3';

export interface FileRecord {
  fileId: string;
  fileName: string;
  filePath: string;
  metadataTags: string;
  vectorEmbedding?: number[];
  lastModifiedUtc: number;
}

export interface DbStats {
  totalFiles: number;
  filesWithEmbeddings: number;
}

export interface SqlFilter {
  column: 'fileName' | 'filePath' | 'metadataTags' | 'lastModifiedUtc';
  operator: '=' | 'LIKE' | '>' | '<' | '>=' | '<=';
  value: string | number;
}

const ALLOWED_COLUMNS = new Set<string>(['fileName', 'filePath', 'metadataTags', 'lastModifiedUtc']);
const ALLOWED_OPERATORS = new Set<string>(['=', 'LIKE', '>', '<', '>=', '<=']);

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS files (
    fileId TEXT PRIMARY KEY,
    fileName TEXT NOT NULL,
    filePath TEXT NOT NULL UNIQUE,
    metadataTags TEXT NOT NULL DEFAULT '',
    vectorEmbedding BLOB,
    lastModifiedUtc INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_files_path ON files(filePath);
  CREATE INDEX IF NOT EXISTS idx_files_modified ON files(lastModifiedUtc);

  CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
    fileId UNINDEXED,
    fileName,
    metadataTags,
    content=files,
    content_rowid=rowid
  );

  CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
    INSERT INTO files_fts(rowid, fileId, fileName, metadataTags)
    VALUES (new.rowid, new.fileId, new.fileName, new.metadataTags);
  END;

  CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
    INSERT INTO files_fts(files_fts, rowid, fileId, fileName, metadataTags)
    VALUES ('delete', old.rowid, old.fileId, old.fileName, old.metadataTags);
  END;

  CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE ON files BEGIN
    INSERT INTO files_fts(files_fts, rowid, fileId, fileName, metadataTags)
    VALUES ('delete', old.rowid, old.fileId, old.fileName, old.metadataTags);
    INSERT INTO files_fts(rowid, fileId, fileName, metadataTags)
    VALUES (new.rowid, new.fileId, new.fileName, new.metadataTags);
  END;
`;

export class SifeDatabase {
  private readonly db: DatabaseType;
  private readonly stmtUpsert: Statement;
  private readonly stmtDeleteByPath: Statement;
  private readonly stmtGetByPath: Statement;
  private readonly stmtGetAll: Statement;
  private readonly stmtGetAllWithEmbeddings: Statement;
  private readonly stmtUpdateEmbedding: Statement;
  private readonly stmtGetStats: Statement;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);

    this.db.pragma('journal_mode=WAL');
    this.db.pragma('synchronous=NORMAL');

    // Run schema in a single transaction for atomicity
    this.db.exec(SCHEMA_SQL);

    this.stmtUpsert = this.db.prepare(`
      INSERT OR REPLACE INTO files (fileId, fileName, filePath, metadataTags, vectorEmbedding, lastModifiedUtc)
      VALUES (@fileId, @fileName, @filePath, @metadataTags, @vectorEmbedding, @lastModifiedUtc)
    `);

    this.stmtDeleteByPath = this.db.prepare(`DELETE FROM files WHERE filePath = ?`);

    this.stmtGetByPath = this.db.prepare(`
      SELECT fileId, fileName, filePath, metadataTags, vectorEmbedding, lastModifiedUtc
      FROM files WHERE filePath = ?
    `);

    this.stmtGetAll = this.db.prepare(`
      SELECT fileId, fileName, filePath, metadataTags, lastModifiedUtc
      FROM files
    `);

    this.stmtGetAllWithEmbeddings = this.db.prepare(`
      SELECT fileId, filePath, vectorEmbedding
      FROM files WHERE vectorEmbedding IS NOT NULL
    `);

    this.stmtUpdateEmbedding = this.db.prepare(`
      UPDATE files SET vectorEmbedding = @vectorEmbedding WHERE fileId = @fileId
    `);

    this.stmtGetStats = this.db.prepare(`
      SELECT
        COUNT(*) AS totalFiles,
        COUNT(vectorEmbedding) AS filesWithEmbeddings
      FROM files
    `);
  }

  upsertFile(record: FileRecord): void {
    const vectorEmbedding =
      record.vectorEmbedding && record.vectorEmbedding.length > 0
        ? Buffer.from(new Float32Array(record.vectorEmbedding).buffer)
        : null;

    this.stmtUpsert.run({
      fileId: record.fileId,
      fileName: record.fileName,
      filePath: record.filePath,
      metadataTags: record.metadataTags,
      vectorEmbedding,
      lastModifiedUtc: record.lastModifiedUtc,
    });
  }

  deleteFile(filePath: string): void {
    this.stmtDeleteByPath.run(filePath);
  }

  getFileByPath(filePath: string): FileRecord | undefined {
    const row = this.stmtGetByPath.get(filePath) as
      | (Omit<FileRecord, 'vectorEmbedding'> & { vectorEmbedding: Buffer | null })
      | undefined;

    if (!row) return undefined;

    return {
      ...row,
      vectorEmbedding: row.vectorEmbedding
        ? Array.from(new Float32Array(row.vectorEmbedding.buffer))
        : undefined,
    };
  }

  getAllFiles(): FileRecord[] {
    const rows = this.stmtGetAll.all() as Array<Omit<FileRecord, 'vectorEmbedding'>>;
    return rows.map((row) => ({ ...row }));
  }

  getAllFilesWithEmbeddings(): Array<{ fileId: string; filePath: string; vectorEmbedding: number[] }> {
    const rows = this.stmtGetAllWithEmbeddings.all() as Array<{
      fileId: string;
      filePath: string;
      vectorEmbedding: Buffer;
    }>;

    return rows.map((row) => ({
      fileId: row.fileId,
      filePath: row.filePath,
      vectorEmbedding: Array.from(new Float32Array(row.vectorEmbedding.buffer)),
    }));
  }

  updateEmbedding(fileId: string, embedding: number[]): void {
    const vectorEmbedding = Buffer.from(new Float32Array(embedding).buffer);
    this.stmtUpdateEmbedding.run({ fileId, vectorEmbedding });
  }

  searchByFTS(query: string, limit = 200): FileRecord[] {
    // Strip FTS5 special chars AND colons (colon = column filter syntax in FTS5)
    const sanitized = query.replace(/["'*^():]/g, ' ').trim();
    if (!sanitized) return [];

    const stmt = this.db.prepare(`
      SELECT f.fileId, f.fileName, f.filePath, f.metadataTags, f.lastModifiedUtc
      FROM files_fts
      JOIN files f ON files_fts.rowid = f.rowid
      WHERE files_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);

    const rows = stmt.all(`${sanitized}*`, limit) as Array<Omit<FileRecord, 'vectorEmbedding'>>;
    return rows.map((row) => ({ ...row }));
  }

  searchBySimilarity(queryEmbedding: number[], topK = 20): FileRecord[] {
    const candidates = this.getAllFilesWithEmbeddings();
    if (candidates.length === 0) return [];

    const scored = candidates.map((c) => ({
      fileId: c.fileId,
      filePath: c.filePath,
      score: SifeDatabase.cosineSimilarity(queryEmbedding, c.vectorEmbedding),
    }));

    scored.sort((a, b) => b.score - a.score);
    const topIds = scored.slice(0, topK).map((s) => s.fileId);

    if (topIds.length === 0) return [];

    const placeholders = topIds.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      SELECT fileId, fileName, filePath, metadataTags, lastModifiedUtc
      FROM files WHERE fileId IN (${placeholders})
    `);

    const rows = stmt.all(...topIds) as Array<Omit<FileRecord, 'vectorEmbedding'>>;

    // Preserve similarity score order
    const rowMap = new Map(rows.map((r) => [r.fileId, r]));
    return topIds
      .map((id) => rowMap.get(id))
      .filter((r): r is Omit<FileRecord, 'vectorEmbedding'> => r !== undefined)
      .map((r) => ({ ...r }));
  }

  applyFilters(filters: SqlFilter[], limit = 200): FileRecord[] {
    if (filters.length === 0) {
      const stmt = this.db.prepare(`
        SELECT fileId, fileName, filePath, metadataTags, lastModifiedUtc
        FROM files LIMIT ?
      `);
      const rows = stmt.all(limit) as Array<Omit<FileRecord, 'vectorEmbedding'>>;
      return rows.map((r) => ({ ...r }));
    }

    const conditions: string[] = [];
    const values: (string | number)[] = [];

    for (const filter of filters) {
      if (!ALLOWED_COLUMNS.has(filter.column)) {
        throw new Error(`Invalid filter column: ${filter.column}`);
      }
      if (!ALLOWED_OPERATORS.has(filter.operator)) {
        throw new Error(`Invalid filter operator: ${filter.operator}`);
      }
      conditions.push(`${filter.column} ${filter.operator} ?`);
      values.push(filter.value);
    }

    values.push(limit);

    const sql = `
      SELECT fileId, fileName, filePath, metadataTags, lastModifiedUtc
      FROM files
      WHERE ${conditions.join(' AND ')}
      LIMIT ?
    `;

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...values) as Array<Omit<FileRecord, 'vectorEmbedding'>>;
    return rows.map((r) => ({ ...r }));
  }

  getStats(): DbStats {
    const row = this.stmtGetStats.get() as { totalFiles: number; filesWithEmbeddings: number };
    return {
      totalFiles: row.totalFiles,
      filesWithEmbeddings: row.filesWithEmbeddings,
    };
  }

  close(): void {
    this.db.close();
  }

  private static cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    return dot / (Math.sqrt(magA) * Math.sqrt(magB) + 1e-8);
  }
}
