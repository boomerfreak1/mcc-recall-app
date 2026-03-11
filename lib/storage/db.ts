import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

/**
 * SQLite database for structured data.
 * Stores documents and chunks metadata.
 */

const DEFAULT_DATA_DIR = process.env.NODE_ENV === "production" ? "/data" : "./data";

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    const dataDir = process.env.DATA_DIR ?? DEFAULT_DATA_DIR;
    fs.mkdirSync(dataDir, { recursive: true });
    const dbPath = path.join(dataDir, "recall.db");
    _db = new Database(dbPath);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
    initSchema(_db);
  }
  return _db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      format TEXT NOT NULL,
      sha TEXT,
      size_bytes INTEGER,
      domain TEXT DEFAULT '',
      chunk_count INTEGER DEFAULT 0,
      indexed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      section_path TEXT NOT NULL,
      section_title TEXT NOT NULL,
      token_estimate INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(document_id, chunk_index)
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id);
    CREATE INDEX IF NOT EXISTS idx_documents_path ON documents(path);
    CREATE INDEX IF NOT EXISTS idx_documents_domain ON documents(domain);
  `);
}

// --- Document CRUD ---

export interface DocumentRow {
  id: number;
  path: string;
  title: string;
  format: string;
  sha: string | null;
  size_bytes: number | null;
  domain: string;
  chunk_count: number;
  indexed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChunkRow {
  id: string;
  document_id: number;
  chunk_index: number;
  content: string;
  section_path: string;
  section_title: string;
  token_estimate: number;
  created_at: string;
}

export function upsertDocument(doc: {
  path: string;
  title: string;
  format: string;
  sha?: string;
  size_bytes?: number;
  domain?: string;
  chunk_count?: number;
}): DocumentRow {
  const db = getDb();

  const existing = db
    .prepare("SELECT * FROM documents WHERE path = ?")
    .get(doc.path) as DocumentRow | undefined;

  if (existing) {
    db.prepare(
      `UPDATE documents
       SET title = ?, format = ?, sha = ?, size_bytes = ?, domain = ?,
           chunk_count = ?, indexed_at = datetime('now'), updated_at = datetime('now')
       WHERE path = ?`
    ).run(
      doc.title,
      doc.format,
      doc.sha ?? null,
      doc.size_bytes ?? null,
      doc.domain ?? "",
      doc.chunk_count ?? 0,
      doc.path
    );
    return db
      .prepare("SELECT * FROM documents WHERE path = ?")
      .get(doc.path) as DocumentRow;
  }

  const result = db.prepare(
    `INSERT INTO documents (path, title, format, sha, size_bytes, domain, chunk_count, indexed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(
    doc.path,
    doc.title,
    doc.format,
    doc.sha ?? null,
    doc.size_bytes ?? null,
    doc.domain ?? "",
    doc.chunk_count ?? 0
  );

  return db
    .prepare("SELECT * FROM documents WHERE id = ?")
    .get(result.lastInsertRowid) as DocumentRow;
}

export function getDocumentByPath(
  docPath: string
): DocumentRow | undefined {
  const db = getDb();
  return db
    .prepare("SELECT * FROM documents WHERE path = ?")
    .get(docPath) as DocumentRow | undefined;
}

export function getAllDocuments(): DocumentRow[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM documents ORDER BY path")
    .all() as DocumentRow[];
}

export function deleteDocument(docPath: string): void {
  const db = getDb();
  db.prepare("DELETE FROM documents WHERE path = ?").run(docPath);
}

// --- Chunk CRUD ---

export function insertChunks(
  chunks: Array<{
    id: string;
    document_id: number;
    chunk_index: number;
    content: string;
    section_path: string;
    section_title: string;
    token_estimate: number;
  }>
): void {
  const db = getDb();
  const insert = db.prepare(
    `INSERT OR REPLACE INTO chunks (id, document_id, chunk_index, content, section_path, section_title, token_estimate)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const insertMany = db.transaction(
    (
      items: Array<{
        id: string;
        document_id: number;
        chunk_index: number;
        content: string;
        section_path: string;
        section_title: string;
        token_estimate: number;
      }>
    ) => {
      for (const chunk of items) {
        insert.run(
          chunk.id,
          chunk.document_id,
          chunk.chunk_index,
          chunk.content,
          chunk.section_path,
          chunk.section_title,
          chunk.token_estimate
        );
      }
    }
  );

  insertMany(chunks);
}

export function getChunksByDocumentId(documentId: number): ChunkRow[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM chunks WHERE document_id = ? ORDER BY chunk_index"
    )
    .all(documentId) as ChunkRow[];
}

export function deleteChunksByDocumentId(documentId: number): void {
  const db = getDb();
  db.prepare("DELETE FROM chunks WHERE document_id = ?").run(documentId);
}

/**
 * Get total stats.
 */
export function getStats(): {
  documentCount: number;
  chunkCount: number;
  totalTokens: number;
} {
  const db = getDb();
  const docs = db
    .prepare("SELECT COUNT(*) as count FROM documents")
    .get() as { count: number };
  const chunks = db
    .prepare(
      "SELECT COUNT(*) as count, COALESCE(SUM(token_estimate), 0) as tokens FROM chunks"
    )
    .get() as { count: number; tokens: number };

  return {
    documentCount: docs.count,
    chunkCount: chunks.count,
    totalTokens: chunks.tokens,
  };
}

/**
 * Clear all data (for full re-index).
 */
export function clearAll(): void {
  const db = getDb();
  db.exec("DELETE FROM chunks; DELETE FROM documents;");
}

/**
 * Health check for SQLite connection.
 */
export function dbHealthCheck(): {
  available: boolean;
  path: string;
  error?: string;
} {
  try {
    const db = getDb();
    db.prepare("SELECT 1").get();
    const dataDir = process.env.DATA_DIR ?? DEFAULT_DATA_DIR;
    return {
      available: true,
      path: path.join(dataDir, "recall.db"),
    };
  } catch (error) {
    const dataDir = process.env.DATA_DIR ?? DEFAULT_DATA_DIR;
    return {
      available: false,
      path: path.join(dataDir, "recall.db"),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
