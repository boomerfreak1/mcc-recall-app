"use client";

import { useEffect, useState } from "react";
import {
  Header,
  HeaderName,
  HeaderNavigation,
  HeaderMenuItem,
  Content,
  Grid,
  Column,
  Tile,
  Button,
  Tag,
  InlineLoading,
  Modal,
  TextInput,
  SkeletonText,
  SkeletonPlaceholder,
} from "@carbon/react";
import {
  Renew,
  CloudUpload,
  Document,
  ChevronDown,
  ChevronUp,
  ArrowRight,
} from "@carbon/icons-react";

// --- Types ---

type TagType = "blue" | "red" | "purple" | "teal" | "cyan" | "green" | "gray" | "magenta" | "cool-gray" | "warm-gray" | "high-contrast" | "outline";

interface DashboardSummary {
  documents: Array<{
    id: number;
    title: string;
    domain: string;
    format: string;
    indexed_at: string;
  }>;
  document_count: number;
  domain_count: number;
  workflow_count: number;
  gap_summary: Array<{
    domain: string;
    workflows: Array<{ workflow_name: string; gap_count: number; open_count: number }>;
    total_gaps: number;
  }>;
  gap_totals: { total: number; open: number; in_progress: number; resolved: number };
  last_indexed_at: string | null;
}

interface IndexResult {
  success: boolean;
  documentsProcessed?: number;
  chunksCreated?: number;
  errors?: Array<{ file: string; error: string }>;
  duration?: string;
  error?: string;
}

// --- Constants ---

const DOMAIN_COLORS: Record<string, TagType> = {
  "C-Suite/ABM": "purple",
  "Innovation Studio": "blue",
  "T+O": "teal",
  "T&O": "teal",
  "IBMer Comms": "cyan",
  "CSR": "green",
  "Intl. Communications": "magenta",
  "Select Demand Strategy": "warm-gray",
  "PMM": "red",
  "PMM Software+Infra+Consulting": "red",
};

const FORMAT_LABELS: Record<string, string> = {
  docx: "DOCX",
  pdf: "PDF",
  pptx: "PPTX",
  xlsx: "XLSX",
  txt: "TXT",
};

const PHASE_LABELS: Record<string, string> = {
  fetch: "Fetching files",
  prepare: "Preparing",
  parse: "Parsing & embedding",
  embed: "Embedding chunks",
  done: "Complete",
  start: "Starting",
};

// --- Helpers ---

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

// --- Helper Components ---

function IndexingProgressBar({ progress }: { progress: { phase: string; current: number; total: number; message: string } }) {
  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const phaseLabel = PHASE_LABELS[progress.phase] ?? progress.phase;

  return (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.375rem" }}>
        <span style={{ fontSize: "0.75rem", fontWeight: 600 }}>
          {phaseLabel}
        </span>
        <span style={{ fontSize: "0.6875rem", color: "var(--cds-text-secondary)" }}>
          {progress.current}/{progress.total} · {pct}%
        </span>
      </div>
      <div style={{
        height: "8px",
        background: "var(--cds-border-subtle, #e0e0e0)",
        borderRadius: "4px",
        overflow: "hidden",
        marginBottom: "0.375rem",
      }}>
        <div style={{
          height: "100%",
          width: `${pct}%`,
          background: "var(--cds-interactive, #0f62fe)",
          borderRadius: "4px",
          transition: "width 0.5s ease",
          minWidth: pct > 0 ? "4px" : "0",
        }} />
      </div>
      <p style={{
        fontSize: "0.6875rem",
        color: "var(--cds-text-secondary)",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}>
        {progress.message}
      </p>
    </div>
  );
}

function SkeletonPanel({ height = "200px" }: { height?: string }) {
  return (
    <Tile style={{ minHeight: height }}>
      <SkeletonText heading width="40%" />
      <SkeletonPlaceholder style={{ width: "100%", height: "60%", marginTop: "1rem" }} />
    </Tile>
  );
}

// --- Main Component ---

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState<{ phase: string; current: number; total: number; message: string } | null>(null);
  const [indexResult, setIndexResult] = useState<IndexResult | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState(false);
  const [indexForce, setIndexForce] = useState(false);
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set());

  const fetchSummary = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/summary");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch dashboard");
    } finally {
      setLoading(false);
    }
  };

  const pollIndexStatus = async () => {
    const poll = async () => {
      try {
        const res = await fetch("/api/index");
        if (!res.ok) return;
        const data = await res.json();

        if (data.running) {
          setIndexProgress(data.progress ?? { phase: "process", current: 0, total: 1, message: "Processing..." });
          setTimeout(poll, 3000);
        } else if (data.result) {
          setIndexing(false);
          setIndexProgress(null);
          setIndexResult(data.result);
          fetchSummary();
        }
      } catch {
        setTimeout(poll, 5000);
      }
    };
    poll();
  };

  const triggerIndex = async (force = false, adminPassword?: string) => {
    setIndexing(true);
    setIndexResult(null);
    const modeLabel = force ? "full re-index" : "incremental index";
    setIndexProgress({ phase: "start", current: 0, total: 1, message: `Starting ${modeLabel}...` });
    try {
      const res = await fetch("/api/index", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force, password: adminPassword }),
      });
      const data = await res.json();
      if (data.started) {
        setTimeout(pollIndexStatus, 2000);
      } else {
        setIndexProgress({ phase: "start", current: 0, total: 1, message: data.error ?? "Indexing in progress" });
        setTimeout(pollIndexStatus, 2000);
      }
    } catch (err) {
      setIndexing(false);
      setIndexProgress(null);
      setIndexResult({
        success: false,
        error: err instanceof Error ? err.message : "Failed to start indexing",
      });
    }
  };

  useEffect(() => {
    fetchSummary();
    fetch("/api/index").then((r) => r.json()).then((data) => {
      if (data.running) {
        setIndexing(true);
        setIndexProgress(data.progress ?? { phase: "process", current: 0, total: 1, message: "Indexing in progress..." });
        pollIndexStatus();
      }
    }).catch(() => {});
  }, []);

  const toggleDomain = (domain: string) => {
    setExpandedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  };

  return (
    <>
      {/* --- Navigation --- */}
      <Header aria-label="Recall">
        <HeaderName href="/" prefix="IBM">
          Recall
        </HeaderName>
        <HeaderNavigation aria-label="Navigation">
          <HeaderMenuItem href="/">Dashboard</HeaderMenuItem>
          <HeaderMenuItem href="/gaps">Gaps</HeaderMenuItem>
          <HeaderMenuItem href="/chat">Chat</HeaderMenuItem>
          <HeaderMenuItem href="/blueprints.html">Blueprints</HeaderMenuItem>
          <HeaderMenuItem href="/heatmap.html">Heatmap</HeaderMenuItem>
        </HeaderNavigation>
      </Header>

      <Content style={{ paddingTop: "3rem" }}>
        <Grid style={{ maxWidth: "1200px", margin: "0 auto" }}>
          {/* Page heading */}
          <Column lg={16} md={8} sm={4} style={{ marginBottom: "1.5rem", paddingTop: "2rem" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <h1 style={{ fontSize: "2.25rem", fontWeight: 300, marginBottom: "0.25rem" }}>
                  Recall
                </h1>
                <p style={{ fontSize: "0.875rem", color: "var(--cds-text-secondary)" }}>
                  Project Intelligence Platform
                </p>
              </div>
              <Button
                kind="ghost"
                size="sm"
                renderIcon={Renew}
                onClick={fetchSummary}
                disabled={loading}
              >
                Refresh
              </Button>
            </div>
          </Column>

          {/* --- Index Status Bar --- */}
          <Column lg={16} md={8} sm={4} style={{ marginBottom: "1.5rem" }}>
            <Tile style={{ padding: "1rem 1.25rem" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
                  {summary?.last_indexed_at && (
                    <span style={{ fontSize: "0.8125rem", color: "var(--cds-text-secondary)" }}>
                      Last indexed: {new Date(summary.last_indexed_at).toLocaleString()}
                    </span>
                  )}
                  {summary && (
                    <span style={{ fontSize: "0.8125rem", color: "var(--cds-text-secondary)" }}>
                      {summary.document_count} documents indexed
                    </span>
                  )}
                </div>
                {indexing ? (
                  <div style={{ minWidth: "300px", flex: 1, maxWidth: "500px" }}>
                    <IndexingProgressBar progress={indexProgress ?? { phase: "start", current: 0, total: 1, message: "Starting..." }} />
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <Button
                      kind="ghost"
                      size="sm"
                      renderIcon={CloudUpload}
                      onClick={() => {
                        setIndexForce(false);
                        setPassword("");
                        setPasswordError(false);
                        setShowPasswordModal(true);
                      }}
                    >
                      Index New Files
                    </Button>
                    <Button
                      kind="ghost"
                      size="sm"
                      renderIcon={Renew}
                      onClick={() => {
                        setIndexForce(true);
                        setPassword("");
                        setPasswordError(false);
                        setShowPasswordModal(true);
                      }}
                    >
                      Force Re-Index
                    </Button>
                  </div>
                )}
              </div>
              {indexResult && !indexing && (
                <div style={{
                  marginTop: "0.75rem",
                  padding: "0.5rem 0.75rem",
                  fontSize: "0.8125rem",
                  background: indexResult.success ? "var(--cds-notification-background-success, #defbe6)" : "var(--cds-notification-background-error, #fff1f1)",
                  borderLeft: `3px solid ${indexResult.success ? "var(--cds-support-success)" : "var(--cds-support-error)"}`,
                  color: "var(--cds-text-primary)",
                }}>
                  {indexResult.success ? (
                    <>
                      <strong>Indexing complete.</strong>{" "}
                      {indexResult.documentsProcessed} documents, {indexResult.chunksCreated} chunks in {indexResult.duration}
                    </>
                  ) : (
                    <><strong style={{ color: "var(--cds-support-error)" }}>Error:</strong> {indexResult.error}</>
                  )}
                </div>
              )}
            </Tile>
          </Column>

          {/* --- Loading State --- */}
          {loading && (
            <>
              <Column lg={5} md={4} sm={4} style={{ marginBottom: "1.5rem" }}>
                <SkeletonPanel height="120px" />
              </Column>
              <Column lg={5} md={4} sm={4} style={{ marginBottom: "1.5rem" }}>
                <SkeletonPanel height="120px" />
              </Column>
              <Column lg={6} md={4} sm={4} style={{ marginBottom: "1.5rem" }}>
                <SkeletonPanel height="120px" />
              </Column>
              <Column lg={16} md={8} sm={4} style={{ marginBottom: "1.5rem" }}>
                <SkeletonPanel height="300px" />
              </Column>
            </>
          )}

          {/* --- Dashboard Content --- */}
          {!loading && summary && (
            <>
              {/* Counts Row */}
              <Column lg={5} md={4} sm={4} style={{ marginBottom: "1.5rem" }}>
                <Tile style={{ padding: "1.25rem", textAlign: "center" }}>
                  <div style={{ fontSize: "3rem", fontWeight: 300, lineHeight: 1 }}>
                    {summary.document_count}
                  </div>
                  <p style={{ fontSize: "0.8125rem", color: "var(--cds-text-secondary)", marginTop: "0.5rem" }}>
                    indexed documents
                  </p>
                </Tile>
              </Column>

              <Column lg={5} md={4} sm={4} style={{ marginBottom: "1.5rem" }}>
                <Tile style={{ padding: "1.25rem", textAlign: "center" }}>
                  <div style={{ fontSize: "3rem", fontWeight: 300, lineHeight: 1 }}>
                    {summary.domain_count}
                  </div>
                  <p style={{ fontSize: "0.8125rem", color: "var(--cds-text-secondary)", marginTop: "0.5rem" }}>
                    domains
                  </p>
                </Tile>
              </Column>

              <Column lg={6} md={4} sm={4} style={{ marginBottom: "1.5rem" }}>
                <Tile style={{ padding: "1.25rem", textAlign: "center" }}>
                  <div style={{ fontSize: "3rem", fontWeight: 300, lineHeight: 1 }}>
                    {summary.workflow_count}
                  </div>
                  <p style={{ fontSize: "0.8125rem", color: "var(--cds-text-secondary)", marginTop: "0.5rem" }}>
                    workflows tracked
                  </p>
                </Tile>
              </Column>

              {/* Two-column: Latest Documents + Gap Totals */}
              <Column lg={10} md={5} sm={4} style={{ marginBottom: "1.5rem" }}>
                <Tile style={{ padding: "1.25rem" }}>
                  <h3 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "1rem", color: "var(--cds-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Latest Documents
                  </h3>
                  {summary.documents.length === 0 ? (
                    <p style={{ fontSize: "0.875rem", color: "var(--cds-text-secondary)", textAlign: "center", padding: "2rem 0" }}>
                      No documents indexed yet. Run the indexer to get started.
                    </p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                      {summary.documents.map((doc) => (
                        <div
                          key={doc.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                            padding: "0.5rem 0",
                            borderBottom: "1px solid var(--cds-border-subtle)",
                          }}
                        >
                          <Document size={16} style={{ color: "var(--cds-icon-secondary)", flexShrink: 0 }} />
                          <span style={{
                            flex: 1,
                            fontSize: "0.8125rem",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}>
                            {doc.title || doc.id}
                          </span>
                          {doc.domain && (
                            <Tag type={DOMAIN_COLORS[doc.domain] ?? "gray"} size="sm" style={{ flexShrink: 0 }}>
                              {doc.domain}
                            </Tag>
                          )}
                          <Tag type="outline" size="sm" style={{ flexShrink: 0 }}>
                            {FORMAT_LABELS[doc.format] ?? doc.format}
                          </Tag>
                          <span style={{ fontSize: "0.6875rem", color: "var(--cds-text-secondary)", flexShrink: 0 }}>
                            {relativeTime(doc.indexed_at)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </Tile>
              </Column>

              <Column lg={6} md={3} sm={4} style={{ marginBottom: "1.5rem" }}>
                <Tile style={{ padding: "1.25rem" }}>
                  <h3 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "1rem", color: "var(--cds-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Gap Totals
                  </h3>
                  {summary.gap_totals.total === 0 ? (
                    <p style={{ fontSize: "0.875rem", color: "var(--cds-text-secondary)", textAlign: "center", padding: "2rem 0" }}>
                      No gaps imported yet.
                    </p>
                  ) : (
                    <>
                      <div style={{ textAlign: "center", marginBottom: "1rem" }}>
                        <div style={{ fontSize: "3rem", fontWeight: 300, lineHeight: 1 }}>
                          {summary.gap_totals.total}
                        </div>
                        <p style={{ fontSize: "0.8125rem", color: "var(--cds-text-secondary)", marginTop: "0.5rem" }}>
                          total gaps
                        </p>
                      </div>
                      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", flexWrap: "wrap", marginBottom: "1rem" }}>
                        {summary.gap_totals.open > 0 && (
                          <Tag type="red" size="sm">{summary.gap_totals.open} open</Tag>
                        )}
                        {summary.gap_totals.in_progress > 0 && (
                          <Tag type="cyan" size="sm">{summary.gap_totals.in_progress} in progress</Tag>
                        )}
                        {summary.gap_totals.resolved > 0 && (
                          <Tag type="green" size="sm">{summary.gap_totals.resolved} resolved</Tag>
                        )}
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <Button kind="ghost" size="sm" renderIcon={ArrowRight} href="/gaps">
                          View All Gaps
                        </Button>
                      </div>
                    </>
                  )}
                </Tile>
              </Column>

              {/* Gaps by Domain & Workflow */}
              {summary.gap_summary.length > 0 && (
                <Column lg={16} md={8} sm={4} style={{ marginBottom: "1.5rem" }}>
                  <Tile style={{ padding: "1.25rem" }}>
                    <h3 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "1rem", color: "var(--cds-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Gaps by Domain & Workflow
                    </h3>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                      {summary.gap_summary.map((domain) => {
                        const isExpanded = expandedDomains.has(domain.domain);
                        return (
                          <div key={domain.domain}>
                            <button
                              onClick={() => toggleDomain(domain.domain)}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "0.75rem",
                                width: "100%",
                                padding: "0.75rem 0.5rem",
                                background: "none",
                                border: "none",
                                borderBottom: "1px solid var(--cds-border-subtle)",
                                cursor: "pointer",
                                textAlign: "left",
                              }}
                            >
                              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                              <span style={{ flex: 1, fontSize: "0.875rem", fontWeight: 600 }}>
                                {domain.domain}
                              </span>
                              <Tag type={DOMAIN_COLORS[domain.domain] ?? "gray"} size="sm">
                                {domain.total_gaps} gaps
                              </Tag>
                            </button>
                            {isExpanded && (
                              <div style={{ paddingLeft: "2rem", paddingBottom: "0.5rem" }}>
                                {domain.workflows.map((wf) => (
                                  <a
                                    key={wf.workflow_name}
                                    href={`/gaps?domain=${encodeURIComponent(domain.domain)}&workflow=${encodeURIComponent(wf.workflow_name)}`}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "0.75rem",
                                      padding: "0.5rem 0.5rem",
                                      borderBottom: "1px solid var(--cds-border-subtle)",
                                      textDecoration: "none",
                                      color: "inherit",
                                    }}
                                  >
                                    <span style={{
                                      flex: 1,
                                      fontSize: "0.8125rem",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                    }}>
                                      {wf.workflow_name || "—"}
                                    </span>
                                    <Tag type="high-contrast" size="sm">
                                      {wf.gap_count}
                                    </Tag>
                                    {wf.open_count > 0 && (
                                      <Tag type="red" size="sm">
                                        {wf.open_count} open
                                      </Tag>
                                    )}
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </Tile>
                </Column>
              )}
            </>
          )}

          {/* Error state */}
          {error && !loading && (
            <Column lg={16} md={8} sm={4}>
              <Tile style={{ padding: "1.5rem", textAlign: "center" }}>
                <p style={{ color: "var(--cds-support-error)", fontSize: "0.875rem" }}>
                  Error loading dashboard: {error}
                </p>
                <Button kind="ghost" size="sm" onClick={fetchSummary} style={{ marginTop: "0.75rem" }}>
                  Retry
                </Button>
              </Tile>
            </Column>
          )}
        </Grid>
      </Content>

      {/* Password Modal for Indexing */}
      <Modal
        open={showPasswordModal}
        onRequestClose={() => setShowPasswordModal(false)}
        onRequestSubmit={async () => {
          if (password.length > 0) {
            setShowPasswordModal(false);
            const pw = password;
            setPassword("");
            setPasswordError(false);
            triggerIndex(indexForce, pw);
          } else {
            setPasswordError(true);
          }
        }}
        modalHeading="Admin Authorization"
        primaryButtonText={indexForce ? "Force Re-Index" : "Index New Files"}
        secondaryButtonText="Cancel"
        size="sm"
      >
        <p style={{ fontSize: "0.875rem", color: "var(--cds-text-secondary)", marginBottom: "1rem" }}>
          {indexForce
            ? "Force re-index will clear all existing data and reprocess all files from GitHub. This takes longer but ensures a clean state."
            : "Incremental index will only process new or changed files, skipping unchanged documents. Much faster for small updates."}
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
              if (password.length > 0) {
                setShowPasswordModal(false);
                const pw = password;
                setPassword("");
                setPasswordError(false);
                triggerIndex(indexForce, pw);
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
