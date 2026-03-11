import { NextResponse } from "next/server";
import { getEmbeddingProvider } from "@/lib/embeddings";
import { chromaHealthCheck, getCollectionStats } from "@/lib/storage/vectorstore";
import { getStats } from "@/lib/storage/db";

/**
 * Health check API endpoint.
 * Returns status of all service connections and index stats.
 */
export async function GET() {
  const checks: Record<string, unknown> = {
    status: "ok",
    timestamp: new Date().toISOString(),
    services: {},
  };

  // Check GitHub connection
  const githubToken = process.env.GITHUB_TOKEN;
  const githubRepo = process.env.GITHUB_REPO;
  let githubStatus: Record<string, unknown>;

  if (githubToken && githubRepo) {
    try {
      const { GitHubClient } = await import("@/lib/github");
      const client = new GitHubClient({
        token: githubToken,
        repo: githubRepo,
      });
      githubStatus = await client.healthCheck();
    } catch (error) {
      githubStatus = {
        connected: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  } else {
    githubStatus = {
      connected: false,
      error: "GITHUB_TOKEN or GITHUB_REPO not configured",
    };
  }

  // Check Ollama / embedding provider
  let embeddingStatus: Record<string, unknown>;
  try {
    const provider = getEmbeddingProvider();
    embeddingStatus = await provider.healthCheck();
  } catch (error) {
    embeddingStatus = {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // Check ChromaDB
  const chromaStatus = await chromaHealthCheck();

  // Check Anthropic API key presence
  const anthropicConfigured = !!process.env.ANTHROPIC_API_KEY;

  // Get index stats
  let indexStats: Record<string, unknown>;
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
    indexStats = { documents: 0, chunks: 0, totalTokens: 0, vectorCount: 0 };
  }

  checks.services = {
    github: githubStatus,
    embeddings: embeddingStatus,
    chromadb: chromaStatus,
    anthropic: {
      configured: anthropicConfigured,
    },
  };

  checks.index = indexStats;

  // Overall status
  const allHealthy =
    (githubStatus as { connected: boolean }).connected &&
    (embeddingStatus as { available: boolean }).available &&
    chromaStatus.available &&
    anthropicConfigured;

  checks.status = allHealthy ? "healthy" : "degraded";

  return NextResponse.json(checks);
}
