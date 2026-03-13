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
  Tag,
  Button,
  Dropdown,
  SkeletonText,
  SkeletonPlaceholder,
  InlineLoading,
} from "@carbon/react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  WarningAltFilled,
  CheckmarkOutline,
  Information,
} from "@carbon/icons-react";

// --- Types ---

type TagType = "blue" | "red" | "purple" | "teal" | "cyan" | "green" | "gray" | "magenta" | "cool-gray" | "warm-gray" | "high-contrast" | "outline";

interface RiskItem {
  id: number;
  entity_id: number | null;
  risk_type: string;
  severity: string;
  description: string;
  suggested_action: string | null;
  detected_at: string;
  resolved_at: string | null;
  dismissed_at: string | null;
}

interface RiskStats {
  total: number;
  active: number;
  bySeverity: Record<string, number>;
  byType: Record<string, number>;
}

interface EntityDetail {
  id: number;
  entity_type: string;
  content: string;
  status: string;
  owner: string | null;
  domain: string;
}

interface TrendPoint {
  snapshot_id: number;
  created_at: string;
  active_risks: number;
}

// --- Constants ---

const SEVERITY_CONFIG: Record<string, { color: TagType; label: string; barColor: string }> = {
  critical: { color: "red", label: "Critical", barColor: "#da1e28" },
  high: { color: "magenta", label: "High", barColor: "#ff832b" },
  medium: { color: "warm-gray", label: "Medium", barColor: "#f1c21b" },
  low: { color: "cool-gray", label: "Low", barColor: "#a8a8a8" },
};

const RISK_TYPE_LABELS: Record<string, string> = {
  stale_gap: "Stale Gap",
  ownerless_dependency: "Ownerless Dependency",
  contradictory_decisions: "Contradictory Decisions",
  orphaned_milestone: "Orphaned Milestone",
  ownership_concentration: "Ownership Concentration",
  stale_decision: "Stale Decision",
};

const ENTITY_TYPE_COLORS: Record<string, TagType> = {
  decision: "blue",
  gap: "red",
  dependency: "purple",
  stakeholder: "teal",
  milestone: "cyan",
  workflow: "green",
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

function scoreColor(score: number): string {
  if (score >= 70) return "var(--cds-support-success)";
  if (score >= 40) return "var(--cds-support-warning)";
  return "var(--cds-support-error)";
}

// --- Components ---

function RiskCard({
  risk,
  onDismiss,
}: {
  risk: RiskItem;
  onDismiss: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [entity, setEntity] = useState<EntityDetail | null>(null);
  const [loadingEntity, setLoadingEntity] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const sevConfig = SEVERITY_CONFIG[risk.severity] ?? SEVERITY_CONFIG.medium;

  const loadEntity = async () => {
    if (entity || !risk.entity_id || loadingEntity) return;
    setLoadingEntity(true);
    try {
      const res = await fetch(`/api/risks/${risk.id}`);
      if (res.ok) {
        const data = await res.json();
        setEntity(data.entity);
      }
    } catch { /* ignore */ }
    setLoadingEntity(false);
  };

  const handleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) loadEntity();
  };

  const handleDismiss = async () => {
    setDismissing(true);
    try {
      const res = await fetch(`/api/risks/${risk.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss" }),
      });
      if (res.ok) {
        onDismiss(risk.id);
      }
    } catch { /* ignore */ }
    setDismissing(false);
  };

  return (
    <Tile style={{ marginBottom: "0.5rem", padding: 0 }}>
      {/* Row header — always visible */}
      <button
        onClick={handleExpand}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          width: "100%",
          padding: "0.875rem 1rem",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <Tag type={sevConfig.color} size="sm" style={{ flexShrink: 0 }}>
          {sevConfig.label}
        </Tag>
        <Tag type="high-contrast" size="sm" style={{ flexShrink: 0 }}>
          {RISK_TYPE_LABELS[risk.risk_type] ?? risk.risk_type}
        </Tag>
        <span style={{
          flex: 1,
          fontSize: "0.8125rem",
          lineHeight: 1.4,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {risk.description.split("\n")[0]}
        </span>
        <span style={{ fontSize: "0.6875rem", color: "var(--cds-text-secondary)", flexShrink: 0 }}>
          {relativeTime(risk.detected_at)}
        </span>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div style={{
          padding: "0 1rem 1rem",
          borderTop: "1px solid var(--cds-border-subtle)",
        }}>
          {/* Full description */}
          <div style={{ marginTop: "0.75rem", marginBottom: "0.75rem" }}>
            <p style={{ fontSize: "0.75rem", color: "var(--cds-text-secondary)", marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Description
            </p>
            <p style={{ fontSize: "0.8125rem", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
              {risk.description}
            </p>
          </div>

          {/* Suggested action */}
          {risk.suggested_action && (
            <div style={{ marginBottom: "0.75rem" }}>
              <p style={{ fontSize: "0.75rem", color: "var(--cds-text-secondary)", marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Suggested Action
              </p>
              <p style={{ fontSize: "0.8125rem", lineHeight: 1.5 }}>
                {risk.suggested_action}
              </p>
            </div>
          )}

          {/* Linked entity */}
          {risk.entity_id && (
            <div style={{ marginBottom: "0.75rem" }}>
              <p style={{ fontSize: "0.75rem", color: "var(--cds-text-secondary)", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Linked Entity
              </p>
              {loadingEntity ? (
                <SkeletonText lineCount={2} />
              ) : entity ? (
                <div style={{
                  padding: "0.625rem",
                  background: "var(--cds-layer-02)",
                  fontSize: "0.8125rem",
                  lineHeight: 1.5,
                }}>
                  <div style={{ display: "flex", gap: "0.375rem", marginBottom: "0.375rem", flexWrap: "wrap" }}>
                    <Tag type={ENTITY_TYPE_COLORS[entity.entity_type] ?? "gray"} size="sm">{entity.entity_type}</Tag>
                    <Tag type={entity.status === "open" ? "red" : entity.status === "resolved" ? "green" : entity.status === "blocked" ? "magenta" : "gray"} size="sm">{entity.status}</Tag>
                    {entity.owner && <Tag type="cool-gray" size="sm">{entity.owner}</Tag>}
                    <Tag type="outline" size="sm">{entity.domain}</Tag>
                  </div>
                  <p>{entity.content}</p>
                </div>
              ) : (
                <p style={{ fontSize: "0.75rem", color: "var(--cds-text-secondary)" }}>Entity not found</p>
              )}
            </div>
          )}

          {/* Dismiss */}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            {dismissing ? (
              <InlineLoading description="Dismissing..." />
            ) : (
              <Button kind="ghost" size="sm" onClick={handleDismiss}>
                Dismiss Risk
              </Button>
            )}
          </div>
        </div>
      )}
    </Tile>
  );
}

function TrendDisplay({ trend }: { trend: TrendPoint[] }) {
  if (trend.length === 0) return null;
  const maxRisks = Math.max(...trend.map((t) => t.active_risks), 1);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: "0.5rem", height: "80px", marginBottom: "0.5rem" }}>
        {trend.map((point, i) => {
          const height = maxRisks > 0 ? (point.active_risks / maxRisks) * 100 : 0;
          return (
            <div key={point.snapshot_id} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "flex-end" }}>
              <span style={{ fontSize: "0.625rem", fontWeight: 600, marginBottom: "0.125rem" }}>
                {point.active_risks}
              </span>
              <div style={{
                width: "100%",
                maxWidth: "40px",
                height: `${Math.max(height, 4)}%`,
                background: point.active_risks > 0
                  ? i === trend.length - 1
                    ? "var(--cds-interactive)"
                    : "var(--cds-border-strong-01)"
                  : "var(--cds-border-subtle)",
                borderRadius: "2px 2px 0 0",
                transition: "height 0.3s ease",
              }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        {trend.map((point) => (
          <div key={point.snapshot_id} style={{ flex: 1, textAlign: "center", fontSize: "0.5625rem", color: "var(--cds-text-secondary)" }}>
            {new Date(point.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Main Component ---

export default function RisksPage() {
  const [risks, setRisks] = useState<RiskItem[]>([]);
  const [stats, setStats] = useState<RiskStats | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [healthScore, setHealthScore] = useState(0);
  const [loading, setLoading] = useState(true);
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const fetchData = async () => {
    setLoading(true);
    try {
      const [risksRes, summaryRes] = await Promise.all([
        fetch("/api/risks"),
        fetch("/api/risks/summary"),
      ]);

      if (risksRes.ok) {
        const data = await risksRes.json();
        setRisks(data.risks ?? []);
        setStats(data.stats ?? null);
      }
      if (summaryRes.ok) {
        const data = await summaryRes.json();
        setTrend(data.trend ?? []);
        setHealthScore(data.health_score ?? 0);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const handleDismiss = (id: number) => {
    setRisks((prev) => prev.filter((r) => r.id !== id));
    if (stats) {
      setStats({ ...stats, active: stats.active - 1 });
    }
  };

  // Filter
  const filtered = risks.filter((r) => {
    if (severityFilter !== "all" && r.severity !== severityFilter) return false;
    if (typeFilter !== "all" && r.risk_type !== typeFilter) return false;
    return true;
  });

  // Severity order for dropdown items
  const severityItems = [
    { id: "all", text: "All Severities" },
    { id: "critical", text: "Critical" },
    { id: "high", text: "High" },
    { id: "medium", text: "Medium" },
    { id: "low", text: "Low" },
  ];

  const typeItems = [
    { id: "all", text: "All Types" },
    ...Object.entries(RISK_TYPE_LABELS).map(([id, text]) => ({ id, text })),
  ];

  return (
    <>
      <Header aria-label="Recall Risks">
        <HeaderName href="/" prefix="IBM">
          Recall
        </HeaderName>
        <HeaderNavigation aria-label="Navigation">
          <HeaderMenuItem href="/">Dashboard</HeaderMenuItem>
          <HeaderMenuItem href="/risks">Risks</HeaderMenuItem>
          <HeaderMenuItem href="/gaps">Gaps</HeaderMenuItem>
          <HeaderMenuItem href="/chat">Chat</HeaderMenuItem>
          <HeaderMenuItem href="/blueprints.html">Blueprints</HeaderMenuItem>
          <HeaderMenuItem href="/heatmap.html">Heatmap</HeaderMenuItem>
        </HeaderNavigation>
      </Header>

      <Content style={{ paddingTop: "3rem" }}>
        <Grid style={{ maxWidth: "1200px", margin: "0 auto" }}>
          {/* Page header */}
          <Column lg={16} md={8} sm={4} style={{ paddingTop: "2rem", marginBottom: "1.5rem" }}>
            <Button kind="ghost" size="sm" renderIcon={ArrowLeft} href="/" style={{ marginBottom: "0.75rem" }}>
              Dashboard
            </Button>
            <h1 style={{ fontSize: "2rem", fontWeight: 300, marginBottom: "0.25rem" }}>
              Risk Radar
            </h1>
            <p style={{ fontSize: "0.875rem", color: "var(--cds-text-secondary)" }}>
              Proactively detected risks across the MCC project corpus
            </p>
          </Column>

          {loading ? (
            <>
              <Column lg={16} md={8} sm={4} style={{ marginBottom: "1.5rem" }}>
                <Tile style={{ minHeight: "80px" }}>
                  <SkeletonText heading width="60%" />
                  <SkeletonPlaceholder style={{ width: "100%", height: "40px", marginTop: "0.5rem" }} />
                </Tile>
              </Column>
              <Column lg={16} md={8} sm={4}>
                <SkeletonText paragraph lineCount={8} />
              </Column>
            </>
          ) : (
            <>
              {/* Summary bar */}
              <Column lg={16} md={8} sm={4} style={{ marginBottom: "1.5rem" }}>
                <Tile style={{ padding: "1rem 1.25rem" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "1.25rem", flexWrap: "wrap" }}>
                      <div>
                        <span style={{ fontSize: "2rem", fontWeight: 300 }}>{stats?.active ?? 0}</span>
                        <span style={{ fontSize: "0.75rem", color: "var(--cds-text-secondary)", marginLeft: "0.5rem" }}>active risks</span>
                      </div>
                      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                        {(["critical", "high", "medium", "low"] as const).map((sev) => {
                          const count = stats?.bySeverity[sev] ?? 0;
                          if (count === 0) return null;
                          const config = SEVERITY_CONFIG[sev];
                          return (
                            <Tag key={sev} type={config.color} size="sm">
                              {count} {config.label}
                            </Tag>
                          );
                        })}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span style={{ fontSize: "0.75rem", color: "var(--cds-text-secondary)" }}>Health</span>
                      <span style={{ fontSize: "1.5rem", fontWeight: 300, color: scoreColor(healthScore) }}>{healthScore}</span>
                    </div>
                  </div>
                </Tile>
              </Column>

              {/* Filters */}
              <Column lg={16} md={8} sm={4} style={{ marginBottom: "1rem" }}>
                <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                  <div style={{ width: "200px" }}>
                    <Dropdown
                      id="severity-filter"
                      titleText="Severity"
                      label="Filter by severity"
                      items={severityItems}
                      itemToString={(item: { id: string; text: string } | null) => item?.text ?? ""}
                      selectedItem={severityItems.find((i) => i.id === severityFilter) ?? severityItems[0]}
                      onChange={({ selectedItem }: { selectedItem: { id: string; text: string } | null }) => {
                        setSeverityFilter(selectedItem?.id ?? "all");
                      }}
                      size="sm"
                    />
                  </div>
                  <div style={{ width: "260px" }}>
                    <Dropdown
                      id="type-filter"
                      titleText="Risk Type"
                      label="Filter by type"
                      items={typeItems}
                      itemToString={(item: { id: string; text: string } | null) => item?.text ?? ""}
                      selectedItem={typeItems.find((i) => i.id === typeFilter) ?? typeItems[0]}
                      onChange={({ selectedItem }: { selectedItem: { id: string; text: string } | null }) => {
                        setTypeFilter(selectedItem?.id ?? "all");
                      }}
                      size="sm"
                    />
                  </div>
                  <div style={{ alignSelf: "flex-end", fontSize: "0.75rem", color: "var(--cds-text-secondary)" }}>
                    Showing {filtered.length} of {risks.length} risks
                  </div>
                </div>
              </Column>

              {/* Risk list */}
              <Column lg={12} md={6} sm={4} style={{ marginBottom: "1.5rem" }}>
                {filtered.length === 0 ? (
                  <Tile style={{ textAlign: "center", padding: "3rem" }}>
                    <CheckmarkOutline size={48} style={{ color: "var(--cds-support-success)", marginBottom: "1rem" }} />
                    <h3 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.5rem" }}>
                      {risks.length === 0 ? "No risks detected" : "No risks match filters"}
                    </h3>
                    <p style={{ fontSize: "0.875rem", color: "var(--cds-text-secondary)" }}>
                      {risks.length === 0
                        ? "Run the indexing pipeline to detect risks across the MCC corpus."
                        : "Try adjusting the severity or type filters."}
                    </p>
                  </Tile>
                ) : (
                  <div>
                    {filtered.map((risk) => (
                      <RiskCard key={risk.id} risk={risk} onDismiss={handleDismiss} />
                    ))}
                  </div>
                )}
              </Column>

              {/* Sidebar: Trend + Info */}
              <Column lg={4} md={2} sm={4} style={{ marginBottom: "1.5rem" }}>
                {/* Trend */}
                <Tile style={{ padding: "1rem", marginBottom: "0.75rem" }}>
                  <h4 style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--cds-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" }}>
                    Risk Trend
                  </h4>
                  {trend.length > 0 ? (
                    <TrendDisplay trend={trend} />
                  ) : (
                    <p style={{ fontSize: "0.75rem", color: "var(--cds-text-secondary)" }}>
                      Trend data available after multiple index runs.
                    </p>
                  )}
                </Tile>

                {/* Risk type info */}
                <Tile style={{ padding: "1rem" }}>
                  <h4 style={{
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    color: "var(--cds-text-secondary)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    marginBottom: "0.75rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.375rem",
                  }}>
                    <Information size={14} />
                    Risk Types
                  </h4>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    {[
                      { type: "Stale Gap", sev: "high", desc: "Open gaps unresolved for 14+ days" },
                      { type: "Ownerless Dep.", sev: "high", desc: "Dependencies with no assigned owner" },
                      { type: "Contradictions", sev: "critical", desc: "Semantically conflicting decisions" },
                      { type: "Orphaned Milestone", sev: "medium", desc: "Milestones with no linked entities" },
                      { type: "Owner Concentration", sev: "medium", desc: "Single owner holds >40% of items" },
                      { type: "Stale Decision", sev: "low", desc: "Decisions 30+ days with no activity" },
                    ].map((item) => (
                      <div key={item.type} style={{ fontSize: "0.6875rem", lineHeight: 1.4 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", marginBottom: "0.125rem" }}>
                          <Tag type={SEVERITY_CONFIG[item.sev]?.color ?? "gray"} size="sm" style={{ transform: "scale(0.85)" }}>
                            {item.sev}
                          </Tag>
                          <strong>{item.type}</strong>
                        </div>
                        <p style={{ color: "var(--cds-text-secondary)", paddingLeft: "0.25rem" }}>
                          {item.desc}
                        </p>
                      </div>
                    ))}
                  </div>
                </Tile>
              </Column>
            </>
          )}
        </Grid>
      </Content>
    </>
  );
}
