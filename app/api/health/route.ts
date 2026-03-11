import { NextResponse } from "next/server";
import { getEmbeddingProvider } from "@/lib/embeddings";
import { chromaHealthCheck, getCollectionStats } from "@/lib/storage/vectorstore";
import { getStats, dbHealthCheck } from "@/lib/storage/db";

/**
 * GET /api/health — comprehensive health check.
 * Returns a JSON status object with each check as a boolean.
 */
export async function GET() {
  const timestamp = new Date().toISOString();

  // 1. Next.js server is running (if we got here, it is)
  const server = true;

  // 2. Ollama is responding and nomic-embed-text is loaded
  let ollama = false;
  let ollamaModel = "";
  let ollamaError = "";
  try {
    const provider = getEmbeddingProvider();
    const check = await provider.healthCheck();
    ollama = check.available;
    ollamaModel = check.model ?? "";
    if (check.error) ollamaError = check.error;
  } catch (error) {
    ollamaError = error instanceof Error ? error.message : String(error);
  }

  // 3. SQLite database is accessible
  let sqlite = false;
  let sqlitePath = "";
  let sqliteError = "";
  try {
    const check = dbHealthCheck();
    sqlite = check.available;
    sqlitePath = check.path;
    if (check.error) sqliteError = check.error;
  } catch (error) {
    sqliteError = error instanceof Error ? error.message : String(error);
  }

  // 4. ChromaDB is accessible
  let chromadb = false;
  let chromaError = "";
  try {
    const check = await chromaHealthCheck();
    chromadb = check.available;
    if (check.error) chromaError = check.error;
  } catch (error) {
    chromaError = error instanceof Error ? error.message : String(error);
  }

  // 5. GitHub API connection is working (valid token)
  let github = false;
  let githubRepo = "";
  let githubError = "";
  const githubToken = process.env.GITHUB_TOKEN;
  const githubRepoEnv = process.env.GITHUB_REPO;

  if (githubToken && githubRepoEnv) {
    try {
      const { GitHubClient } = await import("@/lib/github");
      const client = new GitHubClient({
        token: githubToken,
        repo: githubRepoEnv,
      });
      const check = await client.healthCheck();
      github = check.connected;
      githubRepo = check.repo;
      if (check.error) githubError = check.error;
    } catch (error) {
      githubError = error instanceof Error ? error.message : String(error);
    }
  } else {
    githubError = "GITHUB_TOKEN or GITHUB_REPO not configured";
  }

  // 6. Anthropic API key is configured
  const anthropic = !!process.env.ANTHROPIC_API_KEY;

  // Index stats
  let indexStats = { documents: 0, chunks: 0, totalTokens: 0, vectorCount: 0 };
  try {
    const dbStats = getStats();
    const vectorStats = await getCollectionStats();
    indexStats = {
      documents: dbStats.documentCount,
      chunks: dbStats.chunkCount,
      totalTokens: dbStats.totalTokens,
      vectorCount: vectorStats.count,
    };
  } catch {
    // Stats unavailable, keep defaults
  }

  const allHealthy = server && ollama && sqlite && chromadb && github && anthropic;

  return NextResponse.json({
    status: allHealthy ? "healthy" : "degraded",
    timestamp,
    checks: {
      server,
      ollama,
      sqlite,
      chromadb,
      github,
      anthropic,
    },
    details: {
      ollama: {
        model: ollamaModel,
        ...(ollamaError && { error: ollamaError }),
      },
      sqlite: {
        path: sqlitePath,
        ...(sqliteError && { error: sqliteError }),
      },
      chromadb: {
        ...(chromaError && { error: chromaError }),
      },
      github: {
        repo: githubRepo,
        ...(githubError && { error: githubError }),
      },
    },
    index: indexStats,
  });
}
