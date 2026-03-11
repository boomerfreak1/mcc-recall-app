"use client";

import { useEffect, useState } from "react";
import {
  Header,
  HeaderName,
  Content,
  Grid,
  Column,
  Tile,
  ClickableTile,
  Button,
  Tag,
  InlineLoading,
  Modal,
  TextInput,
} from "@carbon/react";
import {
  Chat,
  Renew,
  DataBase,
  CloudUpload,
  Checkmark,
  CloseFilled,
  Catalog,
} from "@carbon/icons-react";

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

function StatusRow({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.75rem 0", borderBottom: "1px solid var(--cds-border-subtle)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        {ok ? (
          <Checkmark size={20} style={{ color: "var(--cds-support-success)" }} />
        ) : (
          <CloseFilled size={20} style={{ color: "var(--cds-support-error)" }} />
        )}
        <span style={{ fontSize: "0.875rem" }}>{label}</span>
      </div>
      {detail && (
        <span style={{ fontSize: "0.75rem", color: "var(--cds-text-secondary)" }}>{detail}</span>
      )}
    </div>
  );
}

export default function HomePage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [indexResult, setIndexResult] = useState<IndexResult | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState(false);

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
      fetchHealth();
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
    <>
      <Header aria-label="Recall">
        <HeaderName href="/" prefix="IBM">
          Recall
        </HeaderName>
      </Header>

      <Content style={{ paddingTop: "3rem" }}>
        <Grid style={{ maxWidth: "960px", margin: "0 auto" }}>
          {/* Page heading */}
          <Column lg={16} md={8} sm={4} style={{ marginBottom: "2rem", paddingTop: "2rem" }}>
            <h1 style={{ fontSize: "2.25rem", fontWeight: 300, marginBottom: "0.5rem" }}>
              Recall
            </h1>
            <p style={{ fontSize: "1rem", color: "var(--cds-text-secondary)" }}>
              Project Intelligence Platform
            </p>
          </Column>

          {/* System Health */}
          <Column lg={10} md={8} sm={4} style={{ marginBottom: "1.5rem" }}>
            <Tile style={{ height: "100%" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
                <div>
                  <h3 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.25rem" }}>
                    System Health
                  </h3>
                  <p style={{ fontSize: "0.75rem", color: "var(--cds-text-secondary)" }}>
                    {health?.timestamp
                      ? `Last checked: ${new Date(health.timestamp).toLocaleTimeString()}`
                      : "Checking..."}
                  </p>
                </div>
                {health && (
                  <Tag
                    type={health.status === "healthy" ? "green" : "red"}
                    size="md"
                  >
                    {health.status}
                  </Tag>
                )}
              </div>

              {loading && !health && (
                <InlineLoading description="Checking services..." />
              )}

              {error && (
                <p style={{ fontSize: "0.875rem", color: "var(--cds-support-error)" }}>
                  Error: {error}
                </p>
              )}

              {health && (
                <>
                  <StatusRow
                    ok={health.checks.server}
                    label="Next.js Server"
                  />
                  <StatusRow
                    ok={health.checks.ollama}
                    label="Ollama Embeddings"
                    detail={health.details.ollama.embeddingModel || health.details.ollama.error}
                  />
                  <StatusRow
                    ok={health.checks.chatModel}
                    label="Chat Model (Llama)"
                    detail={health.details.chatModel?.model || health.details.chatModel?.error}
                  />
                  <StatusRow
                    ok={health.checks.sqlite}
                    label="SQLite Database"
                    detail={health.details.sqlite.error}
                  />
                  <StatusRow
                    ok={health.checks.chromadb}
                    label="ChromaDB"
                    detail={health.details.chromadb.error}
                  />
                  <StatusRow
                    ok={health.checks.github}
                    label="GitHub"
                    detail={health.checks.github ? health.details.github.repo : health.details.github.error}
                  />

                  {health.index.documents > 0 && (
                    <div style={{ marginTop: "1rem", padding: "0.75rem", background: "var(--cds-layer-02)", fontSize: "0.75rem", color: "var(--cds-text-secondary)" }}>
                      <strong>{health.index.documents}</strong> documents &middot;{" "}
                      <strong>{health.index.chunks}</strong> chunks &middot;{" "}
                      ~<strong>{Math.round(health.index.totalTokens / 1000)}k</strong> tokens &middot;{" "}
                      <strong>{health.index.vectorCount}</strong> vectors
                    </div>
                  )}

                  <div style={{ marginTop: "1rem", display: "flex", justifyContent: "flex-end" }}>
                    <Button
                      kind="ghost"
                      size="sm"
                      renderIcon={Renew}
                      onClick={fetchHealth}
                      disabled={loading}
                    >
                      Refresh
                    </Button>
                  </div>
                </>
              )}
            </Tile>
          </Column>

          {/* Right column: Index + Chat */}
          <Column lg={6} md={8} sm={4} style={{ marginBottom: "1.5rem" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", height: "100%" }}>
              {/* Indexing */}
              <Tile>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                  <DataBase size={20} />
                  <h3 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Indexing</h3>
                </div>
                <p style={{ fontSize: "0.875rem", color: "var(--cds-text-secondary)", marginBottom: "1rem" }}>
                  Pull documents from GitHub, parse, chunk, and embed them.
                </p>

                {indexing ? (
                  <InlineLoading description="Indexing... this may take a few minutes" />
                ) : (
                  <Button
                    kind="primary"
                    size="md"
                    renderIcon={CloudUpload}
                    onClick={() => {
                      setPassword("");
                      setPasswordError(false);
                      setShowPasswordModal(true);
                    }}
                    style={{ width: "100%" }}
                  >
                    Index Now
                  </Button>
                )}

                {indexResult && (
                  <div style={{
                    marginTop: "1rem",
                    padding: "0.75rem",
                    fontSize: "0.875rem",
                    background: indexResult.success ? "var(--cds-support-success)" : "var(--cds-support-error)",
                    color: "#fff",
                  }}>
                    {indexResult.success ? (
                      <>
                        <strong>Indexing complete.</strong>{" "}
                        {indexResult.documentsProcessed} documents, {indexResult.chunksCreated} chunks in {indexResult.duration}
                        {indexResult.errors && indexResult.errors.length > 0 && (
                          <details style={{ marginTop: "0.5rem" }}>
                            <summary style={{ cursor: "pointer" }}>
                              {indexResult.errors.length} errors
                            </summary>
                            <ul style={{ margin: "0.5rem 0 0 1rem", fontSize: "0.75rem" }}>
                              {indexResult.errors.map((e, i) => (
                                <li key={i}>{e.file}: {e.error}</li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </>
                    ) : (
                      <>Error: {indexResult.error}</>
                    )}
                  </div>
                )}
              </Tile>

              {/* Navigation tiles */}
              <div style={{ display: "flex", gap: "1rem" }}>
                <ClickableTile href="/chat" style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: "0.75rem", padding: "1.25rem 1rem", minHeight: "120px" }}>
                  <Chat size={32} />
                  <span style={{ fontSize: "1rem", fontWeight: 600 }}>Open Chat</span>
                  <span style={{ fontSize: "0.75rem", color: "var(--cds-text-secondary)", textAlign: "center" }}>
                    Ask questions about your indexed documents
                  </span>
                </ClickableTile>

                <ClickableTile href="/blueprints.html" style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: "0.75rem", padding: "1.25rem 1rem", minHeight: "120px" }}>
                  <Catalog size={32} />
                  <span style={{ fontSize: "1rem", fontWeight: 600 }}>Blueprints</span>
                  <span style={{ fontSize: "0.75rem", color: "var(--cds-text-secondary)", textAlign: "center" }}>
                    View all MCC workflow blueprints
                  </span>
                </ClickableTile>
              </div>
            </div>
          </Column>
        </Grid>
      </Content>

      <Modal
        open={showPasswordModal}
        onRequestClose={() => setShowPasswordModal(false)}
        onRequestSubmit={() => {
          if (password === "42069Dwightiscool") {
            setShowPasswordModal(false);
            setPassword("");
            setPasswordError(false);
            triggerIndex();
          } else {
            setPasswordError(true);
          }
        }}
        modalHeading="Admin Authorization"
        primaryButtonText="Start Indexing"
        secondaryButtonText="Cancel"
        size="sm"
      >
        <p style={{ fontSize: "0.875rem", color: "var(--cds-text-secondary)", marginBottom: "1rem" }}>
          Re-indexing will temporarily make the chat unavailable. Enter the admin password to continue.
        </p>
        <TextInput
          id="index-password"
          type="password"
          labelText="Password"
          placeholder="Enter admin password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setPasswordError(false);
          }}
          invalid={passwordError}
          invalidText="Incorrect password."
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (password === "42069Dwightiscool") {
                setShowPasswordModal(false);
                setPassword("");
                setPasswordError(false);
                triggerIndex();
              } else {
                setPasswordError(true);
              }
            }
          }}
          autoFocus
        />
      </Modal>
    </>
  );
}
