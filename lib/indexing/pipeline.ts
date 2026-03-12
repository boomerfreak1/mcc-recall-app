import fs from "fs";
import { GitHubClient, getGitHubClient } from "../github";
import { parseDocument, isSupported } from "../parsers";
import { chunkDocument, Chunk } from "./chunker";
import { getEmbeddingProvider } from "../embeddings";
import { extractEntitiesBatch, extractRelations } from "../ai";
import type { ExtractedEntity } from "../ai";
import { computeChangeDelta } from "./differ";
import type { PreviousEntity } from "./differ";
import { runRiskDetection, computeHealthScores } from "../risk";
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
  insertEntities,
  insertEntityRelations,
  deleteEntitiesByDocumentId,
  createIndexSnapshot,
  getEntityStats,
  getEntitiesWithDocumentPath,
  getChunkDocumentPathMap,
  updateSnapshotChangeDelta,
  updateEntityLastSeen,
  updateEntityResolved,
  getEntities,
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

  // Step 2: Capture previous entities for change detection, then clear
  progress("prepare", 0, 1, "Capturing previous entity snapshot...");
  let previousEntities: PreviousEntity[] = [];
  try {
    const prevWithDocs = getEntitiesWithDocumentPath();
    previousEntities = prevWithDocs.map((e) => ({
      id: e.id,
      entity_type: e.entity_type,
      content: e.content,
      status: e.status,
      owner: e.owner,
      domain: e.domain,
      document_path: e.document_path,
    }));
    if (previousEntities.length > 0) {
      console.log(`[index] Captured ${previousEntities.length} previous entities for change detection`);
    }
  } catch (err) {
    console.warn("[index] Failed to capture previous entities:", err instanceof Error ? err.message : err);
  }

  progress("prepare", 0, 1, "Clearing existing index...");
  clearAll();
  await resetCollection();
  progress("prepare", 1, 1, "Index cleared");

  const embedder = getEmbeddingProvider();

  // Step 3 — Phase 1: Fetch, parse, chunk, embed all files (fast)
  interface ParsedFile {
    file: typeof supportedFiles[0];
    chunks: Chunk[];
    docRow: ReturnType<typeof upsertDocument>;
    domain: string;
  }
  const parsedFiles: ParsedFile[] = [];
  let totalEligibleChunks = 0;

  for (let i = 0; i < supportedFiles.length; i++) {
    const file = supportedFiles[i];
    progress(
      "parse",
      i,
      supportedFiles.length,
      `Parsing & embedding: ${file.path.split("/").pop()}`
    );

    try {
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
      const parsed = await parseDocument(buffer, file.path);
      const chunks = chunkDocument(parsed);
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

      progress(
        "embed",
        i,
        supportedFiles.length,
        `Embedding ${chunks.length} chunks from ${file.path.split("/").pop()}`
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

      const eligible = chunks.filter((c) => c.tokenEstimate >= 50).length;
      totalEligibleChunks += eligible;
      parsedFiles.push({ file, chunks, docRow, domain });
      chunksCreated += chunks.length;
      documentsProcessed++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[index] Error processing ${file.path}:`, msg);
      errors.push({ file: file.path, error: msg });
    }
  }

  // Step 4 — Phase 2: Entity extraction with chunk-level progress
  let chunksExtracted = 0;
  progress("extract", 0, totalEligibleChunks, `Extracting entities: 0/${totalEligibleChunks} chunks`);

  for (const pf of parsedFiles) {
    const allDocEntities: Array<{ entity: ExtractedEntity; chunkId: string }> = [];

    try {
      const batchInput = pf.chunks.map((c) => ({ content: c.content, tokenEstimate: c.tokenEstimate }));
      const batchResults = await extractEntitiesBatch(batchInput, (processed, _total) => {
        const globalProcessed = chunksExtracted + processed;
        progress(
          "extract",
          globalProcessed,
          totalEligibleChunks,
          `Extracting entities: ${globalProcessed}/${totalEligibleChunks} chunks (${pf.file.path.split("/").pop()})`
        );
      });

      // Count eligible chunks in this file for the global counter
      const eligibleInFile = pf.chunks.filter((c) => c.tokenEstimate >= 50).length;
      chunksExtracted += eligibleInFile;

      for (const [chunkIdx, entities] of batchResults) {
        if (entities.length > 0 && chunkIdx < pf.chunks.length) {
          const chunk = pf.chunks[chunkIdx];
          const storedEntities = insertEntities(
            entities.map((e) => ({
              chunk_id: chunk.id,
              entity_type: e.entity_type,
              content: e.content,
              status: e.status,
              owner: e.owner,
              domain: pf.domain,
              confidence: e.confidence,
            }))
          );
          for (let k = 0; k < entities.length; k++) {
            allDocEntities.push({ entity: entities[k], chunkId: storedEntities[k]?.chunk_id ?? chunk.id });
          }
        }
      }
    } catch (err) {
      console.warn(`[index] Batch entity extraction failed for ${pf.file.path}:`, err instanceof Error ? err.message : err);
    }

    // Relation extraction per document
    if (allDocEntities.length >= 2) {
      try {
        const entityList = allDocEntities.map((e) => e.entity);
        const relations = await extractRelations(entityList);

        if (relations.length > 0) {
          const db = (await import("../storage/db")).getDb();
          const docEntityRows = db
            .prepare(
              `SELECT e.id, e.content FROM entities e
               JOIN chunks c ON e.chunk_id = c.id
               WHERE c.document_id = ?
               ORDER BY e.id`
            )
            .all(pf.docRow.id) as Array<{ id: number; content: string }>;

          if (docEntityRows.length >= 2) {
            const validRelations = relations
              .filter(
                (r) =>
                  r.source_index < docEntityRows.length &&
                  r.target_index < docEntityRows.length
              )
              .map((r) => ({
                source_entity_id: docEntityRows[r.source_index].id,
                target_entity_id: docEntityRows[r.target_index].id,
                relation_type: r.relation_type,
                confidence: r.confidence,
              }));

            if (validRelations.length > 0) {
              insertEntityRelations(validRelations);
            }
          }
        }
      } catch (err) {
        console.warn(`[index] Relation extraction failed for ${pf.file.path}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  // Phase 2: Change detection + snapshot
  progress("detect", 0, 1, "Running semantic change detection...");
  let changeDelta: Record<string, unknown> | undefined;
  try {
    const currentEntities = getEntities();
    const docPathMap = getChunkDocumentPathMap();
    const delta = await computeChangeDelta(currentEntities, docPathMap, previousEntities);
    changeDelta = delta as unknown as Record<string, unknown>;

    // Update entity timestamps based on change classification
    const modifiedIds = delta.changes
      .filter((c) => c.change_category === "modified" || c.change_category === "unchanged")
      .map((c) => c.entity_id);
    if (modifiedIds.length > 0) {
      updateEntityLastSeen(modifiedIds);
    }

    // Note: "resolved" entities in the delta refer to previous entity IDs
    // that no longer exist (they were cleared). We log them in the delta
    // but can't update their rows since they've been deleted.

    console.log(`[index] Change detection complete: ${delta.summary.new} new, ${delta.summary.resolved} resolved, ${delta.summary.modified} modified, ${delta.summary.unchanged} unchanged`);
  } catch (err) {
    console.warn("[index] Change detection failed:", err instanceof Error ? err.message : err);
  }

  // Phase 3: Risk detection
  progress("risk", 0, 1, "Running risk detection...");
  let riskResult: Record<string, unknown> | undefined;
  try {
    const result = await runRiskDetection();
    riskResult = result as unknown as Record<string, unknown>;
    console.log(`[index] Risk detection: ${result.risks_detected} risks found in ${result.duration_ms}ms`);
    progress("risk", 1, 1, `Found ${result.risks_detected} risks`);
  } catch (err) {
    console.warn("[index] Risk detection failed:", err instanceof Error ? err.message : err);
  }

  // Phase 3: Compute health scores
  let healthScores: Record<string, unknown> | undefined;
  try {
    const scores = computeHealthScores();
    healthScores = scores as unknown as Record<string, unknown>;
    console.log(`[index] Health scores: overall=${scores.overall_score}, domains=${scores.domains.length}`);
  } catch (err) {
    console.warn("[index] Health score computation failed:", err instanceof Error ? err.message : err);
  }

  // Create index snapshot with change delta and health scores
  try {
    const entityStats = getEntityStats();
    createIndexSnapshot({
      entity_summary: entityStats,
      health_scores: healthScores,
      change_delta: changeDelta,
    });
  } catch (err) {
    console.warn("[index] Failed to create index snapshot:", err instanceof Error ? err.message : err);
  }

  const duration = Date.now() - startTime;
  const entityStats = getEntityStats();
  progress(
    "done",
    supportedFiles.length,
    supportedFiles.length,
    `Indexed ${documentsProcessed} documents, ${chunksCreated} chunks, ${entityStats.total} entities in ${(duration / 1000).toFixed(1)}s`
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
    deleteEntitiesByDocumentId(existing.id);
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

  // Phase 2: Batched entity extraction for incremental indexing
  const allDocEntities: Array<{ entity: ExtractedEntity; chunkId: string }> = [];

  try {
    const batchInput = chunks.map((c) => ({ content: c.content, tokenEstimate: c.tokenEstimate }));
    const batchResults = await extractEntitiesBatch(batchInput);

    for (const [chunkIdx, entities] of batchResults) {
      if (entities.length > 0 && chunkIdx < chunks.length) {
        const chunk = chunks[chunkIdx];
        const storedEntities = insertEntities(
          entities.map((e) => ({
            chunk_id: chunk.id,
            entity_type: e.entity_type,
            content: e.content,
            status: e.status,
            owner: e.owner,
            domain,
            confidence: e.confidence,
          }))
        );
        for (let k = 0; k < entities.length; k++) {
          allDocEntities.push({ entity: entities[k], chunkId: storedEntities[k]?.chunk_id ?? chunk.id });
        }
      }
    }
  } catch (err) {
    console.warn(`[index] Batch entity extraction failed for ${filePath}:`, err instanceof Error ? err.message : err);
  }

  if (allDocEntities.length >= 2) {
    try {
      const entityList = allDocEntities.map((e) => e.entity);
      const relations = await extractRelations(entityList);

      if (relations.length > 0) {
        const db = (await import("../storage/db")).getDb();
        const docEntityRows = db
          .prepare(
            `SELECT e.id, e.content FROM entities e
             JOIN chunks c ON e.chunk_id = c.id
             WHERE c.document_id = ?
             ORDER BY e.id`
          )
          .all(docRow.id) as Array<{ id: number; content: string }>;

        if (docEntityRows.length >= 2) {
          const validRelations = relations
            .filter(
              (r) =>
                r.source_index < docEntityRows.length &&
                r.target_index < docEntityRows.length
            )
            .map((r) => ({
              source_entity_id: docEntityRows[r.source_index].id,
              target_entity_id: docEntityRows[r.target_index].id,
              relation_type: r.relation_type,
              confidence: r.confidence,
            }));

          if (validRelations.length > 0) {
            insertEntityRelations(validRelations);
          }
        }
      }
    } catch (err) {
      console.warn(`[index] Relation extraction failed for ${filePath}:`, err instanceof Error ? err.message : err);
    }
  }

  return { chunks: chunks.length };
}
