import fs from "fs";
import { GitHubClient, getGitHubClient } from "../github";
import { parseDocument, isSupported } from "../parsers";
import { chunkDocument, Chunk } from "./chunker";
import { getEmbeddingProvider } from "../embeddings";
import {
  upsertDocument,
  insertChunks,
  deleteChunksByDocumentId,
  getDocumentByPath,
  getStats,
  clearAll,
  addChunks as addVectorChunks,
  deleteDocumentChunks,
  resetCollection,
} from "../storage";

/**
 * Full indexing pipeline: GitHub -> Parse -> Chunk -> Embed -> Store.
 */

const DEFAULT_DATA_DIR = process.env.NODE_ENV === "production" ? "/data" : "./data";

/**
 * Ensure the data directory exists (handles fresh persistent volumes on first deploy).
 */
function ensureDataDir(): void {
  const dataDir = process.env.DATA_DIR ?? DEFAULT_DATA_DIR;
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(`${dataDir}/chroma`, { recursive: true });
}

/**
 * Check if the index is empty (first deploy / fresh volume).
 */
export function isIndexEmpty(): boolean {
  try {
    const stats = getStats();
    return stats.documentCount === 0;
  } catch {
    return true;
  }
}

export interface IndexProgress {
  phase: string;
  current: number;
  total: number;
  message: string;
}

export type ProgressCallback = (progress: IndexProgress) => void;

export interface IndexResult {
  documentsProcessed: number;
  chunksCreated: number;
  errors: Array<{ file: string; error: string }>;
  duration: number;
}

/**
 * Infer domain from file path.
 * E.g., "workflows/workflows-MCC_T+O_Analysis_Cards.docx" -> "T+O"
 */
function inferDomain(filePath: string): string {
  const fileName = filePath.split("/").pop() ?? "";

  // Try to extract domain from MCC naming convention
  const mccMatch = fileName.match(/MCC[_\s]+(.+?)(?:_Analysis|_analysis|\.\w+$)/i);
  if (mccMatch) return mccMatch[1].replace(/_/g, " ");

  // Use parent folder as domain
  const parts = filePath.split("/");
  if (parts.length > 1) return parts[0];

  return "general";
}

/**
 * Run the full indexing pipeline.
 * Pulls all supported files from GitHub, parses, chunks, embeds, and stores.
 */
export async function runFullIndex(
  onProgress?: ProgressCallback
): Promise<IndexResult> {
  const startTime = Date.now();
  const errors: Array<{ file: string; error: string }> = [];
  let documentsProcessed = 0;
  let chunksCreated = 0;

  const progress = (phase: string, current: number, total: number, message: string) => {
    onProgress?.({ phase, current, total, message });
  };

  // Step 0: Ensure data directory exists (fresh deploy)
  ensureDataDir();

  // Step 1: List files from GitHub
  progress("fetch", 0, 1, "Connecting to GitHub...");
  const github = getGitHubClient();
  const allFiles = await github.listFiles();
  const supportedFiles = allFiles.filter((f) => isSupported(f.path));

  progress(
    "fetch",
    1,
    1,
    `Found ${supportedFiles.length} supported files out of ${allFiles.length} total`
  );

  // Step 2: Clear existing data for full re-index
  progress("prepare", 0, 1, "Clearing existing index...");
  clearAll();
  await resetCollection();
  progress("prepare", 1, 1, "Index cleared");

  const embedder = getEmbeddingProvider();

  // Step 3: Process each file
  for (let i = 0; i < supportedFiles.length; i++) {
    const file = supportedFiles[i];
    progress(
      "process",
      i,
      supportedFiles.length,
      `Processing: ${file.path}`
    );

    try {
      // Fetch file content from GitHub
      const rawUrl = `https://raw.githubusercontent.com/${process.env.GITHUB_REPO}/main/${file.path}`;
      const response = await fetch(rawUrl, {
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} fetching ${file.path}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      // Parse
      const parsed = await parseDocument(buffer, file.path);

      // Chunk
      const chunks = chunkDocument(parsed);

      // Store document in SQLite
      const domain = inferDomain(file.path);
      const docRow = upsertDocument({
        path: file.path,
        title: parsed.title,
        format: parsed.format,
        sha: file.sha,
        size_bytes: file.size,
        domain,
        chunk_count: chunks.length,
      });

      // Store chunks in SQLite
      insertChunks(
        chunks.map((c) => ({
          id: c.id,
          document_id: docRow.id,
          chunk_index: c.chunkIndex,
          content: c.content,
          section_path: c.sectionPath,
          section_title: c.sectionTitle,
          token_estimate: c.tokenEstimate,
        }))
      );

      // Generate embeddings and store in ChromaDB
      progress(
        "embed",
        i,
        supportedFiles.length,
        `Embedding ${chunks.length} chunks from ${file.path}`
      );

      const embeddings = await embedder.generateEmbeddings(
        chunks.map((c) => c.content)
      );

      await addVectorChunks(
        chunks.map((c, j) => ({
          id: c.id,
          content: c.content,
          embedding: embeddings[j].embedding,
          metadata: {
            document_id: String(docRow.id),
            document_path: c.documentPath,
            document_title: c.documentTitle,
            doc_type: c.format,
            domain,
            section_path: c.sectionPath,
            section_title: c.sectionTitle,
            chunk_index: c.chunkIndex,
            token_estimate: c.tokenEstimate,
          },
        }))
      );

      documentsProcessed++;
      chunksCreated += chunks.length;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[index] Error processing ${file.path}:`, msg);
      errors.push({ file: file.path, error: msg });
    }
  }

  const duration = Date.now() - startTime;
  progress(
    "done",
    supportedFiles.length,
    supportedFiles.length,
    `Indexed ${documentsProcessed} documents, ${chunksCreated} chunks in ${(duration / 1000).toFixed(1)}s`
  );

  return { documentsProcessed, chunksCreated, errors, duration };
}

/**
 * Index a single file (for incremental updates via webhook).
 */
export async function indexFile(
  filePath: string,
  github?: GitHubClient
): Promise<{ chunks: number }> {
  const client = github ?? getGitHubClient();
  const embedder = getEmbeddingProvider();

  // Fetch content
  const rawUrl = `https://raw.githubusercontent.com/${process.env.GITHUB_REPO}/main/${filePath}`;
  const response = await fetch(rawUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${filePath}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  // Parse and chunk
  const parsed = await parseDocument(buffer, filePath);
  const chunks = chunkDocument(parsed);
  const domain = inferDomain(filePath);

  // Check if document already exists
  const existing = getDocumentByPath(filePath);
  if (existing) {
    deleteChunksByDocumentId(existing.id);
    await deleteDocumentChunks(filePath);
  }

  // Store in SQLite
  const treeFiles = await client.listFiles();
  const fileInfo = treeFiles.find((f) => f.path === filePath);

  const docRow = upsertDocument({
    path: filePath,
    title: parsed.title,
    format: parsed.format,
    sha: fileInfo?.sha,
    size_bytes: fileInfo?.size,
    domain,
    chunk_count: chunks.length,
  });

  insertChunks(
    chunks.map((c) => ({
      id: c.id,
      document_id: docRow.id,
      chunk_index: c.chunkIndex,
      content: c.content,
      section_path: c.sectionPath,
      section_title: c.sectionTitle,
      token_estimate: c.tokenEstimate,
    }))
  );

  // Embed and store in ChromaDB
  const embeddings = await embedder.generateEmbeddings(
    chunks.map((c) => c.content)
  );

  await addVectorChunks(
    chunks.map((c, j) => ({
      id: c.id,
      content: c.content,
      embedding: embeddings[j].embedding,
      metadata: {
        document_id: String(docRow.id),
        document_path: c.documentPath,
        document_title: c.documentTitle,
        doc_type: c.format,
        domain,
        section_path: c.sectionPath,
        section_title: c.sectionTitle,
        chunk_index: c.chunkIndex,
        token_estimate: c.tokenEstimate,
      },
    }))
  );

  return { chunks: chunks.length };
}
