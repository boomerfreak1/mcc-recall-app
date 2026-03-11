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

interface ServiceStatus {
  github: {
    connected: boolean;
    repo?: string;
    defaultBranch?: string;
    error?: string;
  };
  embeddings: {
    available: boolean;
    provider?: string;
    model?: string;
    error?: string;
  };
  anthropic: {
    configured: boolean;
  };
}

interface HealthResponse {
  status: string;
  timestamp: string;
  services: ServiceStatus;
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

export default function HealthPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
            {loading && (
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
                  <div>
                    <StatusBadge
                      ok={health.services.github.connected}
                      label={
                        health.services.github.connected
                          ? `GitHub: ${health.services.github.repo}`
                          : "GitHub: Not connected"
                      }
                    />
                    {health.services.github.error && (
                      <p className="text-xs text-muted-foreground ml-5 mt-1">
                        {health.services.github.error}
                      </p>
                    )}
                  </div>

                  <div>
                    <StatusBadge
                      ok={health.services.embeddings.available}
                      label={
                        health.services.embeddings.available
                          ? `Embeddings: ${health.services.embeddings.provider} (${health.services.embeddings.model})`
                          : "Embeddings: Unavailable"
                      }
                    />
                    {health.services.embeddings.error && (
                      <p className="text-xs text-muted-foreground ml-5 mt-1">
                        {health.services.embeddings.error}
                      </p>
                    )}
                  </div>

                  <div>
                    <StatusBadge
                      ok={health.services.anthropic.configured}
                      label={
                        health.services.anthropic.configured
                          ? "Anthropic API: Configured"
                          : "Anthropic API: Not configured"
                      }
                    />
                  </div>
                </div>

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
      </div>
    </main>
  );
}
