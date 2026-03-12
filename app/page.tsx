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
  ClickableTile,
  Button,
  Tag,
  InlineLoading,
  Modal,
  TextInput,
  SkeletonText,
  SkeletonPlaceholder,
} from "@carbon/react";
import {
  Chat,
  Renew,
  CloudUpload,
  Catalog,
  HeatMap,
  ArrowUp,
  ArrowDown,
  Subtract,
  WarningAltFilled,
  CheckmarkOutline,
  Add,
  Edit,
  Time,
} from "@carbon/icons-react";

// --- Types ---

interface DashboardSummary {
  health_score: number;
  previous_health_score: number | null;
  entity_counts: Record<string, number>;
  previous_entity_counts: Record<string, number> | null;
  open_gaps: number;
  total_entities: number;
  domain_summaries: Array<{
    domain: string;
    total: number;
    open: number;
    blocked: number;
    recent_change: {
      content: string;
      change_category: string;
      entity_type: string;
    } | null;
  }>;
  recent_changes: Array<{
    content: string;
    change_category: string;
    entity_type: string;
    domain: string;
    source_document?: string;
  }>;
  attention_queue: Array<{
    id: number;
    entity_type: string;
    content: string;
    domain: string;
    severity: "high" | "medium";
    reason: string;
  }>;
  last_indexed_at: string | null;
  has_entities: boolean;
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

type TagType = "blue" | "red" | "purple" | "teal" | "cyan" | "green" | "gray" | "magenta" | "cool-gray" | "warm-gray" | "high-contrast" | "outline";

const TYPE_COLORS: Record<string, TagType> = {
  decision: "blue",
  gap: "red",
  dependency: "purple",
  stakeholder: "teal",
  milestone: "cyan",
  workflow: "green",
};

const CHANGE_ICONS: Record<string, { icon: typeof Add; color: string; label: string }> = {
  new: { icon: Add, color: "var(--cds-support-success)", label: "New" },
  resolved: { icon: CheckmarkOutline, color: "var(--cds-support-info)", label: "Resolved" },
  modified: { icon: Edit, color: "var(--cds-support-warning)", label: "Modified" },
};

const COUNTER_LABELS: Record<string, string> = {
  decisions: "Decisions",
  gaps: "Open Gaps",
  dependencies: "Dependencies",
  stakeholders: "Stakeholders",
  milestones: "Milestones",
  workflows: "Workflows",
};

// --- Helper Components ---

function TrendIndicator({ current, previous }: { current: number; previous: number | undefined }) {
  if (previous === undefined || previous === null) {
    return <Subtract size={14} style={{ color: "var(--cds-text-secondary)" }} />;
  }
  const diff = current - previous;
  if (diff > 0) return <ArrowUp size={14} style={{ color: "var(--cds-support-success)" }} />;
  if (diff < 0) return <ArrowDown size={14} style={{ color: "var(--cds-support-error)" }} />;
  return <Subtract size={14} style={{ color: "var(--cds-text-secondary)" }} />;
}

function HealthScoreDisplay({ score, previousScore }: { score: number; previousScore: number | null }) {
  const color = score >= 70
    ? "var(--cds-support-success)"
    : score >= 40
    ? "var(--cds-support-warning)"
    : "var(--cds-support-error)";

  const trend = previousScore !== null ? score - previousScore : null;

  return (
    <div style={{ textAlign: "center", padding: "1.5rem 1rem" }}>
      <p style={{ fontSize: "0.75rem", color: "var(--cds-text-secondary)", marginBottom: "0.5rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Project Health
      </p>
      <div style={{ fontSize: "4rem", fontWeight: 300, color, lineHeight: 1 }}>
        {score}
      </div>
      <div style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "var(--cds-text-secondary)" }}>
        {trend !== null ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
            {trend > 0 ? <ArrowUp size={12} style={{ color: "var(--cds-support-success)" }} /> : trend < 0 ? <ArrowDown size={12} style={{ color: "var(--cds-support-error)" }} /> : null}
            {trend > 0 ? `+${trend}` : trend} vs previous
          </span>
        ) : (
          "First snapshot — no trend data"
        )}
      </div>
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
  const [indexResult, setIndexResult] = useState<IndexResult | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState(false);

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

  const triggerIndex = async () => {
    setIndexing(true);
    setIndexResult(null);
    try {
      const res = await fetch("/api/index", { method: "POST" });
      const data = await res.json();
      setIndexResult(data);
      fetchSummary();
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
    fetchSummary();
  }, []);

  const hasEntities = summary?.has_entities ?? false;

  return (
    <>
      {/* --- Navigation --- */}
      <Header aria-label="Recall">
        <HeaderName href="/" prefix="IBM">
          Recall
        </HeaderName>
        <HeaderNavigation aria-label="Navigation">
          <HeaderMenuItem href="/">Dashboard</HeaderMenuItem>
          <HeaderMenuItem href="/chat">Chat</HeaderMenuItem>
          <HeaderMenuItem href="/blueprints.html">Blueprints</HeaderMenuItem>
          <HeaderMenuItem href="/heatmap.html">Heatmap</HeaderMenuItem>
        </HeaderNavigation>
        {summary?.last_indexed_at && (
          <div style={{
            marginLeft: "auto",
            marginRight: "1rem",
            display: "flex",
            alignItems: "center",
            gap: "0.375rem",
            fontSize: "0.75rem",
            color: "var(--cds-text-secondary)",
          }}>
            <Time size={14} />
            Last indexed: {new Date(summary.last_indexed_at).toLocaleString()}
          </div>
        )}
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
                  Living Project Dashboard
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

          {/* --- Empty State: No Entities --- */}
          {!loading && !hasEntities && (
            <Column lg={16} md={8} sm={4} style={{ marginBottom: "1.5rem" }}>
              <Tile style={{ padding: "2rem", textAlign: "center" }}>
                <WarningAltFilled size={48} style={{ color: "var(--cds-support-warning)", marginBottom: "1rem" }} />
                <h3 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.5rem" }}>
                  No entities extracted yet
                </h3>
                <p style={{ fontSize: "0.875rem", color: "var(--cds-text-secondary)", marginBottom: "1.5rem", maxWidth: "480px", margin: "0 auto 1.5rem" }}>
                  The dashboard requires entity data from the indexing pipeline. Run a full index to extract decisions, gaps, dependencies, stakeholders, and milestones from your MCC corpus.
                </p>
                {indexing ? (
                  <InlineLoading description="Indexing... this may take a few minutes" />
                ) : (
                  <Button
                    kind="primary"
                    renderIcon={CloudUpload}
                    onClick={() => {
                      setPassword("");
                      setPasswordError(false);
                      setShowPasswordModal(true);
                    }}
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
                    textAlign: "left",
                  }}>
                    {indexResult.success ? (
                      <>
                        <strong>Indexing complete.</strong>{" "}
                        {indexResult.documentsProcessed} documents, {indexResult.chunksCreated} chunks in {indexResult.duration}
                      </>
                    ) : (
                      <>Error: {indexResult.error}</>
                    )}
                  </div>
                )}
              </Tile>
            </Column>
          )}

          {/* --- Loading State --- */}
          {loading && (
            <>
              <Column lg={5} md={4} sm={4} style={{ marginBottom: "1.5rem" }}>
                <SkeletonPanel height="180px" />
              </Column>
              <Column lg={11} md={4} sm={4} style={{ marginBottom: "1.5rem" }}>
                <SkeletonPanel height="180px" />
              </Column>
              <Column lg={16} md={8} sm={4} style={{ marginBottom: "1.5rem" }}>
                <SkeletonPanel height="140px" />
              </Column>
              <Column lg={8} md={4} sm={4} style={{ marginBottom: "1.5rem" }}>
                <SkeletonPanel height="300px" />
              </Column>
              <Column lg={8} md={4} sm={4} style={{ marginBottom: "1.5rem" }}>
                <SkeletonPanel height="300px" />
              </Column>
            </>
          )}

          {/* --- Dashboard Content --- */}
          {!loading && hasEntities && summary && (
            <>
              {/* TOP ROW: Health Score + Entity Counters */}
              <Column lg={5} md={4} sm={4} style={{ marginBottom: "1.5rem" }}>
                <Tile style={{ height: "100%" }}>
                  <HealthScoreDisplay
                    score={summary.health_score}
                    previousScore={summary.previous_health_score}
                  />
                </Tile>
              </Column>

              <Column lg={11} md={4} sm={4} style={{ marginBottom: "1.5rem" }}>
                <Tile style={{ height: "100%", padding: "1.25rem" }}>
                  <h3 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "1rem", color: "var(--cds-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Entity Counters
                  </h3>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem" }}>
                    {Object.entries(COUNTER_LABELS).map(([key, label]) => {
                      const current = summary.entity_counts[key] ?? 0;
                      const previous = summary.previous_entity_counts?.[key];
                      return (
                        <div key={key} style={{ textAlign: "center" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.375rem" }}>
                            <span style={{ fontSize: "1.75rem", fontWeight: 300 }}>{current}</span>
                            <TrendIndicator current={current} previous={previous} />
                          </div>
                          <p style={{ fontSize: "0.75rem", color: "var(--cds-text-secondary)", marginTop: "0.125rem" }}>
                            {label}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </Tile>
              </Column>

              {/* MIDDLE ROW: Domain Summary Cards */}
              {summary.domain_summaries.length > 0 && (
                <Column lg={16} md={8} sm={4} style={{ marginBottom: "1.5rem" }}>
                  <h3 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.75rem", color: "var(--cds-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Domains
                  </h3>
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                    gap: "0.75rem",
                  }}>
                    {summary.domain_summaries.map((d) => (
                      <ClickableTile
                        key={d.domain}
                        href={`/domains/${encodeURIComponent(d.domain)}`}
                        style={{ padding: "1rem" }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
                          <h4 style={{ fontSize: "0.875rem", fontWeight: 600 }}>
                            {d.domain}
                          </h4>
                          <Tag type="cool-gray" size="sm">{d.total}</Tag>
                        </div>
                        <div style={{ fontSize: "0.75rem", color: "var(--cds-text-secondary)", marginBottom: "0.5rem" }}>
                          {d.open > 0 && (
                            <span style={{ color: "var(--cds-support-warning)" }}>
                              {d.open} open
                            </span>
                          )}
                          {d.open > 0 && d.blocked > 0 && " · "}
                          {d.blocked > 0 && (
                            <span style={{ color: "var(--cds-support-error)" }}>
                              {d.blocked} blocked
                            </span>
                          )}
                          {d.open === 0 && d.blocked === 0 && (
                            <span>All clear</span>
                          )}
                        </div>
                        {d.recent_change && (
                          <div style={{
                            fontSize: "0.6875rem",
                            color: "var(--cds-text-secondary)",
                            borderTop: "1px solid var(--cds-border-subtle)",
                            paddingTop: "0.5rem",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}>
                            <Tag type={TYPE_COLORS[d.recent_change.entity_type] ?? "gray"} size="sm" style={{ marginRight: "0.25rem" }}>
                              {d.recent_change.change_category}
                            </Tag>
                            {d.recent_change.content.substring(0, 60)}
                            {d.recent_change.content.length > 60 ? "..." : ""}
                          </div>
                        )}
                      </ClickableTile>
                    ))}
                  </div>
                </Column>
              )}

              {/* BOTTOM ROW: Recent Changes + Attention Queue */}
              <Column lg={8} md={4} sm={4} style={{ marginBottom: "1.5rem" }}>
                <Tile style={{ height: "100%", padding: "1.25rem" }}>
                  <h3 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "1rem", color: "var(--cds-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Recent Changes
                  </h3>
                  {summary.recent_changes.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "2rem 0", color: "var(--cds-text-secondary)" }}>
                      <p style={{ fontSize: "0.875rem" }}>No changes detected yet.</p>
                      <p style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>
                        Changes will appear after the second indexing run.
                      </p>
                    </div>
                  ) : (
                    <div style={{ maxHeight: "400px", overflowY: "auto" }}>
                      {summary.recent_changes.map((change, i) => {
                        const changeInfo = CHANGE_ICONS[change.change_category];
                        const Icon = changeInfo?.icon ?? Edit;
                        const iconColor = changeInfo?.color ?? "var(--cds-text-secondary)";
                        return (
                          <div
                            key={i}
                            style={{
                              display: "flex",
                              gap: "0.75rem",
                              padding: "0.625rem 0",
                              borderBottom: i < summary.recent_changes.length - 1
                                ? "1px solid var(--cds-border-subtle)"
                                : "none",
                              alignItems: "flex-start",
                            }}
                          >
                            <Icon size={16} style={{ color: iconColor, flexShrink: 0, marginTop: "0.125rem" }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <p style={{
                                fontSize: "0.8125rem",
                                lineHeight: 1.4,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                              }}>
                                {change.content}
                              </p>
                              <div style={{ display: "flex", gap: "0.25rem", marginTop: "0.25rem", flexWrap: "wrap" }}>
                                <Tag type={TYPE_COLORS[change.entity_type] ?? "gray"} size="sm">
                                  {change.entity_type}
                                </Tag>
                                {change.source_document && (
                                  <span style={{ fontSize: "0.6875rem", color: "var(--cds-text-secondary)", alignSelf: "center" }}>
                                    {change.source_document.split("/").pop()}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Tile>
              </Column>

              <Column lg={8} md={4} sm={4} style={{ marginBottom: "1.5rem" }}>
                <Tile style={{ height: "100%", padding: "1.25rem" }}>
                  <h3 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "1rem", color: "var(--cds-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Attention Queue
                  </h3>
                  {summary.attention_queue.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "2rem 0", color: "var(--cds-text-secondary)" }}>
                      <CheckmarkOutline size={32} style={{ marginBottom: "0.5rem" }} />
                      <p style={{ fontSize: "0.875rem" }}>Nothing needs attention right now.</p>
                    </div>
                  ) : (
                    <div style={{ maxHeight: "400px", overflowY: "auto" }}>
                      {summary.attention_queue.map((item, i) => (
                        <div
                          key={`${item.id}-${i}`}
                          style={{
                            display: "flex",
                            gap: "0.75rem",
                            padding: "0.625rem 0",
                            borderBottom: i < summary.attention_queue.length - 1
                              ? "1px solid var(--cds-border-subtle)"
                              : "none",
                            alignItems: "flex-start",
                          }}
                        >
                          <Tag
                            type={item.severity === "high" ? "red" : "warm-gray"}
                            size="sm"
                            style={{ flexShrink: 0 }}
                          >
                            {item.severity}
                          </Tag>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{
                              fontSize: "0.8125rem",
                              lineHeight: 1.4,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                            }}>
                              {item.content}
                            </p>
                            <div style={{ display: "flex", gap: "0.375rem", marginTop: "0.25rem", alignItems: "center" }}>
                              <Tag type={TYPE_COLORS[item.entity_type] ?? "gray"} size="sm">
                                {item.entity_type}
                              </Tag>
                              <span style={{ fontSize: "0.6875rem", color: "var(--cds-text-secondary)" }}>
                                {item.domain}
                              </span>
                              <span style={{ fontSize: "0.6875rem", color: "var(--cds-text-secondary)" }}>
                                · {item.reason}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Tile>
              </Column>

              {/* Quick Nav Row */}
              <Column lg={16} md={8} sm={4} style={{ marginBottom: "1.5rem" }}>
                <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                  <ClickableTile href="/chat" style={{ flex: "1 1 140px", display: "flex", alignItems: "center", gap: "0.75rem", padding: "1rem" }}>
                    <Chat size={24} />
                    <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>Chat</span>
                  </ClickableTile>
                  <ClickableTile href="/blueprints.html" style={{ flex: "1 1 140px", display: "flex", alignItems: "center", gap: "0.75rem", padding: "1rem" }}>
                    <Catalog size={24} />
                    <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>Blueprints</span>
                  </ClickableTile>
                  <ClickableTile href="/heatmap.html" style={{ flex: "1 1 140px", display: "flex", alignItems: "center", gap: "0.75rem", padding: "1rem" }}>
                    <HeatMap size={24} />
                    <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>Heatmap</span>
                  </ClickableTile>
                  <Tile style={{ flex: "1 1 140px", display: "flex", alignItems: "center", gap: "0.75rem", padding: "1rem" }}>
                    {indexing ? (
                      <InlineLoading description="Indexing..." />
                    ) : (
                      <Button
                        kind="ghost"
                        size="sm"
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
                  </Tile>
                </div>
              </Column>
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
          Re-indexing will pull documents from GitHub, extract entities, and run change detection. Enter the admin password to continue.
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
