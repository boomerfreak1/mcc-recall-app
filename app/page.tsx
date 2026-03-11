"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface HealthChecks {
  server: boolean;
  ollama: boolean;
  sqlite: boolean;
  chromadb: boolean;
  github: boolean;
  chatModel: boolean;
}

interface HealthDetails {
  ollama: { embeddingModel?: string; error?: string };
  chatModel: { model?: string; error?: string };
  sqlite: { path?: string; error?: string };
  chromadb: { error?: string };
  github: { repo?: string; error?: string };
}

interface IndexStats {
  documents: number;
  chunks: number;
  totalTokens: number;
  vectorCount: number;
}

interface HealthResponse {
  status: string;
  timestamp: string;
  checks: HealthChecks;
  details: HealthDetails;
  index: IndexStats;
}

interface IndexResult {
  success: boolean;
  documentsProcessed?: number;
  chunksCreated?: number;
  errors?: Array<{ file: string; error: string }>;
  duration?: string;
  error?: string;
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`h-3 w-3 rounded-full ${ok ? "bg-green-500" : "bg-red-500"}`}
      />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export default function HomePage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [indexResult, setIndexResult] = useState<IndexResult | null>(null);

  const fetchHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/health");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setHealth(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch health");
    } finally {
      setLoading(false);
    }
  };

  const triggerIndex = async () => {
    setIndexing(true);
    setIndexResult(null);
    try {
      const res = await fetch("/api/index", { method: "POST" });
      const data = await res.json();
      setIndexResult(data);
      fetchHealth(); // Refresh stats after indexing
    } catch (err) {
      setIndexResult({
        success: false,
        error: err instanceof Error ? err.message : "Indexing failed",
      });
    } finally {
      setIndexing(false);
    }
  };

  useEffect(() => {
    fetchHealth();
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-gray-50">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">Recall</h1>
          <p className="text-muted-foreground">
            Project Intelligence Platform
          </p>
        </div>

        {/* System Health */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">System Health</CardTitle>
            <CardDescription>
              {health?.timestamp
                ? `Last checked: ${new Date(health.timestamp).toLocaleTimeString()}`
                : "Checking..."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading && !health && (
              <p className="text-sm text-muted-foreground">
                Checking services...
              </p>
            )}

            {error && (
              <p className="text-sm text-red-600">Error: {error}</p>
            )}

            {health && (
              <>
                <div className="space-y-3">
                  <StatusBadge
                    ok={health.checks.server}
                    label="Next.js Server"
                  />

                  <div>
                    <StatusBadge
                      ok={health.checks.ollama}
                      label={
                        health.checks.ollama
                          ? `Ollama Embeddings (${health.details.ollama.embeddingModel})`
                          : "Ollama Embeddings"
                      }
                    />
                    {health.details.ollama.error && (
                      <p className="text-xs text-muted-foreground ml-5 mt-1">
                        {health.details.ollama.error}
                      </p>
                    )}
                  </div>

                  <div>
                    <StatusBadge
                      ok={health.checks.sqlite}
                      label="SQLite Database"
                    />
                    {health.details.sqlite.error && (
                      <p className="text-xs text-muted-foreground ml-5 mt-1">
                        {health.details.sqlite.error}
                      </p>
                    )}
                  </div>

                  <div>
                    <StatusBadge
                      ok={health.checks.chromadb}
                      label="ChromaDB"
                    />
                    {health.details.chromadb.error && (
                      <p className="text-xs text-muted-foreground ml-5 mt-1">
                        {health.details.chromadb.error}
                      </p>
                    )}
                  </div>

                  <div>
                    <StatusBadge
                      ok={health.checks.github}
                      label={
                        health.checks.github
                          ? `GitHub: ${health.details.github.repo}`
                          : "GitHub"
                      }
                    />
                    {health.details.github.error && (
                      <p className="text-xs text-muted-foreground ml-5 mt-1">
                        {health.details.github.error}
                      </p>
                    )}
                  </div>

                  <div>
                    <StatusBadge
                      ok={health.checks.chatModel}
                      label={
                        health.checks.chatModel
                          ? `Chat Model (${health.details.chatModel?.model ?? "llama3.2:3b"})`
                          : "Chat Model (Llama)"
                      }
                    />
                    {health.details.chatModel?.error && (
                      <p className="text-xs text-muted-foreground ml-5 mt-1">
                        {health.details.chatModel.error}
                      </p>
                    )}
                  </div>
                </div>

                {/* Index Stats */}
                {health.index.documents > 0 && (
                  <div className="pt-2 border-t text-xs text-muted-foreground space-y-1">
                    <p>
                      {health.index.documents} documents, {health.index.chunks} chunks,{" "}
                      ~{Math.round(health.index.totalTokens / 1000)}k tokens indexed
                    </p>
                    <p>{health.index.vectorCount} vectors in ChromaDB</p>
                  </div>
                )}

                <div className="pt-2 border-t">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      Overall:{" "}
                      <span
                        className={
                          health.status === "healthy"
                            ? "text-green-600"
                            : "text-yellow-600"
                        }
                      >
                        {health.status}
                      </span>
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={fetchHealth}
                      disabled={loading}
                    >
                      Refresh
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Indexing */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Indexing</CardTitle>
            <CardDescription>
              Pull documents from GitHub, parse, chunk, and embed them.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              onClick={triggerIndex}
              disabled={indexing}
              className="w-full"
            >
              {indexing ? "Indexing... (this may take a few minutes)" : "Index Now"}
            </Button>

            {indexResult && (
              <div
                className={`text-sm p-3 rounded-md ${
                  indexResult.success
                    ? "bg-green-50 text-green-800"
                    : "bg-red-50 text-red-800"
                }`}
              >
                {indexResult.success ? (
                  <>
                    <p className="font-medium">Indexing complete</p>
                    <p>
                      {indexResult.documentsProcessed} documents,{" "}
                      {indexResult.chunksCreated} chunks indexed in{" "}
                      {indexResult.duration}
                    </p>
                    {indexResult.errors && indexResult.errors.length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer">
                          {indexResult.errors.length} errors
                        </summary>
                        <ul className="mt-1 text-xs space-y-1">
                          {indexResult.errors.map((e, i) => (
                            <li key={i}>
                              {e.file}: {e.error}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </>
                ) : (
                  <p>Error: {indexResult.error}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Navigation */}
        <Card>
          <CardContent className="pt-6">
            <a href="/chat">
              <Button variant="outline" className="w-full">
                Open Chat &rarr;
              </Button>
            </a>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
