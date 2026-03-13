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
  Renew,
  CheckmarkOutline,
} from "@carbon/icons-react";

// --- Types ---

type TagType = "blue" | "red" | "purple" | "teal" | "cyan" | "green" | "gray" | "magenta" | "cool-gray" | "warm-gray" | "high-contrast" | "outline";

interface GapItem {
  id: number;
  domain: string;
  workflow_name: string;
  gap_description: string;
  gap_type: string;
  recommended_next_step: string;
  status: string;
  imported_at: string;
}

interface GapStats {
  total: number;
  byStatus: Record<string, number>;
  byDomain: Record<string, number>;
  byType: Record<string, number>;
  topWorkflows: Array<{ workflow_name: string; domain: string; count: number }>;
  domainCount: number;
}

// --- Constants ---

const STATUS_CONFIG: Record<string, { color: TagType; label: string }> = {
  open: { color: "red", label: "Open" },
  "in-progress": { color: "cyan", label: "In Progress" },
  resolved: { color: "green", label: "Resolved" },
};

const DOMAIN_COLORS: Record<string, TagType> = {
  "C-Suite/ABM": "purple",
  "Innovation Studio": "blue",
  "T&O": "teal",
  "IBMer Comms": "cyan",
  "CSR": "green",
  "Intl. Communications": "magenta",
  "Select Demand Strategy": "warm-gray",
  "PMM": "red",
};

// --- Components ---

function GapCard({
  gap,
  onStatusChange,
}: {
  gap: GapItem;
  onStatusChange: (id: number, status: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [updating, setUpdating] = useState(false);
  const statusConfig = STATUS_CONFIG[gap.status] ?? STATUS_CONFIG.open;

  const handleStatusChange = async (newStatus: string) => {
    setUpdating(true);
    try {
      const res = await fetch(`/api/gaps/${gap.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        onStatusChange(gap.id, newStatus);
      }
    } catch { /* ignore */ }
    setUpdating(false);
  };

  return (
    <Tile style={{ marginBottom: "0.5rem", padding: 0 }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          width: "100%",
          padding: "0.875rem 1rem",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <Tag type={DOMAIN_COLORS[gap.domain] ?? "gray"} size="sm" style={{ flexShrink: 0 }}>
          {gap.domain}
        </Tag>
        <Tag type="green" size="sm" style={{ flexShrink: 0 }}>
          {gap.workflow_name || "—"}
        </Tag>
        {gap.gap_type && (
          <Tag type="high-contrast" size="sm" style={{ flexShrink: 0 }}>
            {gap.gap_type}
          </Tag>
        )}
        <span style={{
          flex: 1,
          fontSize: "0.8125rem",
          lineHeight: 1.4,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {gap.gap_description.split("\n")[0]}
        </span>
        <Tag type={statusConfig.color} size="sm" style={{ flexShrink: 0 }}>
          {statusConfig.label}
        </Tag>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {expanded && (
        <div style={{
          padding: "0 1rem 1rem",
          borderTop: "1px solid var(--cds-border-subtle)",
        }}>
          <div style={{ marginTop: "0.75rem", marginBottom: "0.75rem" }}>
            <p style={{ fontSize: "0.75rem", color: "var(--cds-text-secondary)", marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Gap Description
            </p>
            <p style={{ fontSize: "0.8125rem", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
              {gap.gap_description}
            </p>
          </div>

          {gap.recommended_next_step && (
            <div style={{ marginBottom: "0.75rem" }}>
              <p style={{ fontSize: "0.75rem", color: "var(--cds-text-secondary)", marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Recommended Next Step
              </p>
              <p style={{ fontSize: "0.8125rem", lineHeight: 1.5 }}>
                {gap.recommended_next_step}
              </p>
            </div>
          )}

          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", alignItems: "center" }}>
            {updating ? (
              <InlineLoading description="Updating..." />
            ) : (
              <>
                {gap.status !== "open" && (
                  <Button kind="ghost" size="sm" onClick={() => handleStatusChange("open")}>
                    Re-open
                  </Button>
                )}
                {gap.status !== "in-progress" && (
                  <Button kind="ghost" size="sm" onClick={() => handleStatusChange("in-progress")}>
                    In Progress
                  </Button>
                )}
                {gap.status !== "resolved" && (
                  <Button kind="tertiary" size="sm" onClick={() => handleStatusChange("resolved")}>
                    Resolve
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </Tile>
  );
}

// --- Main Component ---

export default function GapsPage() {
  const [gaps, setGaps] = useState<GapItem[]>([]);
  const [stats, setStats] = useState<GapStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [workflowFilter, setWorkflowFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/gaps");
      if (res.ok) {
        const data = await res.json();
        setGaps(data.gaps ?? []);
        setStats(data.stats ?? null);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("domain")) setDomainFilter(params.get("domain")!);
    if (params.get("workflow")) setWorkflowFilter(params.get("workflow")!);
    fetchData();
  }, []);

  const handleImport = async () => {
    setImporting(true);
    try {
      const res = await fetch("/api/gaps/import", { method: "POST" });
      if (res.ok) {
        await fetchData();
      }
    } catch { /* ignore */ }
    setImporting(false);
  };

  const handleStatusChange = (id: number, newStatus: string) => {
    setGaps((prev) =>
      prev.map((g) => (g.id === id ? { ...g, status: newStatus } : g))
    );
  };

  // Build filter options
  const domainItems = [
    { id: "all", text: "All Domains" },
    ...Object.keys(stats?.byDomain ?? {}).map((d) => ({ id: d, text: d })),
  ];

  const typeItems = [
    { id: "all", text: "All Gap Types" },
    ...Object.keys(stats?.byType ?? {}).map((t) => ({ id: t, text: t })),
  ];

  const statusItems = [
    { id: "all", text: "All Statuses" },
    { id: "open", text: "Open" },
    { id: "in-progress", text: "In Progress" },
    { id: "resolved", text: "Resolved" },
  ];

  // Filter
  const filtered = gaps.filter((g) => {
    if (domainFilter !== "all" && g.domain !== domainFilter) return false;
    if (workflowFilter !== "all" && g.workflow_name !== workflowFilter) return false;
    if (typeFilter !== "all" && g.gap_type !== typeFilter) return false;
    if (statusFilter !== "all" && g.status !== statusFilter) return false;
    return true;
  });

  return (
    <>
      <Header aria-label="Recall Gaps">
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
          {/* Page header */}
          <Column lg={16} md={8} sm={4} style={{ paddingTop: "2rem", marginBottom: "1.5rem" }}>
            <Button kind="ghost" size="sm" renderIcon={ArrowLeft} href="/" style={{ marginBottom: "0.75rem" }}>
              Dashboard
            </Button>
            <h1 style={{ fontSize: "2rem", fontWeight: 300, marginBottom: "0.25rem" }}>
              Gaps Tracker
            </h1>
            <p style={{ fontSize: "0.875rem", color: "var(--cds-text-secondary)" }}>
              Discovery gaps across all MCC domain workflows
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
                        <span style={{ fontSize: "2rem", fontWeight: 300 }}>{stats?.total ?? 0}</span>
                        <span style={{ fontSize: "0.75rem", color: "var(--cds-text-secondary)", marginLeft: "0.5rem" }}>total gaps</span>
                      </div>
                      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                        {(["open", "in-progress", "resolved"] as const).map((s) => {
                          const count = stats?.byStatus[s] ?? 0;
                          if (count === 0) return null;
                          const config = STATUS_CONFIG[s];
                          return (
                            <Tag key={s} type={config.color} size="sm">
                              {count} {config.label}
                            </Tag>
                          );
                        })}
                      </div>
                      <div>
                        <span style={{ fontSize: "0.875rem", color: "var(--cds-text-secondary)" }}>
                          {stats?.domainCount ?? 0} domains
                        </span>
                      </div>
                    </div>
                  </div>
                </Tile>
              </Column>

              {/* Filters */}
              <Column lg={16} md={8} sm={4} style={{ marginBottom: "1rem" }}>
                <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "flex-end" }}>
                  <div style={{ width: "200px" }}>
                    <Dropdown
                      id="domain-filter"
                      titleText="Domain"
                      label="Filter by domain"
                      items={domainItems}
                      itemToString={(item: { id: string; text: string } | null) => item?.text ?? ""}
                      selectedItem={domainItems.find((i) => i.id === domainFilter) ?? domainItems[0]}
                      onChange={({ selectedItem }: { selectedItem: { id: string; text: string } | null }) => {
                        setDomainFilter(selectedItem?.id ?? "all");
                      }}
                      size="sm"
                    />
                  </div>
                  <div style={{ width: "200px" }}>
                    <Dropdown
                      id="type-filter"
                      titleText="Gap Type"
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
                  <div style={{ width: "180px" }}>
                    <Dropdown
                      id="status-filter"
                      titleText="Status"
                      label="Filter by status"
                      items={statusItems}
                      itemToString={(item: { id: string; text: string } | null) => item?.text ?? ""}
                      selectedItem={statusItems.find((i) => i.id === statusFilter) ?? statusItems[0]}
                      onChange={({ selectedItem }: { selectedItem: { id: string; text: string } | null }) => {
                        setStatusFilter(selectedItem?.id ?? "all");
                      }}
                      size="sm"
                    />
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--cds-text-secondary)" }}>
                    Showing {filtered.length} of {gaps.length} gaps
                  </div>
                  <div style={{ marginLeft: "auto" }}>
                    {importing ? (
                      <InlineLoading description="Importing..." />
                    ) : (
                      <Button kind="ghost" size="sm" renderIcon={Renew} onClick={handleImport}>
                        Re-import from Excel
                      </Button>
                    )}
                  </div>
                </div>
              </Column>

              {/* Main content + sidebar */}
              <Column lg={12} md={6} sm={4} style={{ marginBottom: "1.5rem" }}>
                {filtered.length === 0 ? (
                  <Tile style={{ textAlign: "center", padding: "3rem" }}>
                    <CheckmarkOutline size={48} style={{ color: "var(--cds-support-success)", marginBottom: "1rem" }} />
                    <h3 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.5rem" }}>
                      {gaps.length === 0 ? "No gaps imported" : "No gaps match filters"}
                    </h3>
                    <p style={{ fontSize: "0.875rem", color: "var(--cds-text-secondary)" }}>
                      {gaps.length === 0
                        ? "Click \"Re-import from Excel\" to load gaps from the tracker."
                        : "Try adjusting the domain, type, or status filters."}
                    </p>
                  </Tile>
                ) : (
                  <div>
                    {filtered.map((gap) => (
                      <GapCard key={gap.id} gap={gap} onStatusChange={handleStatusChange} />
                    ))}
                  </div>
                )}
              </Column>

              {/* Sidebar */}
              <Column lg={4} md={2} sm={4} style={{ marginBottom: "1.5rem" }}>
                {/* Gaps by Domain */}
                <Tile style={{ padding: "1rem", marginBottom: "0.75rem" }}>
                  <h4 style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--cds-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" }}>
                    Gaps by Domain
                  </h4>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    {Object.entries(stats?.byDomain ?? {}).map(([domain, count]) => {
                      const maxCount = Math.max(...Object.values(stats?.byDomain ?? {}), 1);
                      const pct = (count / maxCount) * 100;
                      return (
                        <div key={domain}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.6875rem", marginBottom: "0.125rem" }}>
                            <span>{domain}</span>
                            <span style={{ fontWeight: 600 }}>{count}</span>
                          </div>
                          <div style={{ height: "6px", background: "var(--cds-border-subtle)", borderRadius: "3px" }}>
                            <div style={{
                              height: "100%",
                              width: `${pct}%`,
                              background: "var(--cds-interactive)",
                              borderRadius: "3px",
                              transition: "width 0.3s ease",
                            }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Tile>

                {/* Gap Types */}
                {Object.keys(stats?.byType ?? {}).length > 0 && (
                  <Tile style={{ padding: "1rem", marginBottom: "0.75rem" }}>
                    <h4 style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--cds-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" }}>
                      Gap Types
                    </h4>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                      {Object.entries(stats?.byType ?? {}).map(([type, count]) => (
                        <div key={type} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.6875rem" }}>
                          <span>{type}</span>
                          <Tag type="high-contrast" size="sm">{count}</Tag>
                        </div>
                      ))}
                    </div>
                  </Tile>
                )}

                {/* Top Workflows */}
                <Tile style={{ padding: "1rem" }}>
                  <h4 style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--cds-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" }}>
                    Top Workflows by Gap Count
                  </h4>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    {(stats?.topWorkflows ?? []).map((wf, i) => (
                      <div key={i} style={{ fontSize: "0.6875rem" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.125rem" }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>
                            {wf.workflow_name || "—"}
                          </span>
                          <Tag type="high-contrast" size="sm">{wf.count}</Tag>
                        </div>
                        <span style={{ fontSize: "0.625rem", color: "var(--cds-text-secondary)" }}>{wf.domain}</span>
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
