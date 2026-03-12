import { NextRequest } from "next/server";
import {
  getEntityStats,
  getEntities,
  getLatestSnapshot,
  getRecentSnapshots,
} from "@/lib/storage";
import { getDb } from "@/lib/storage/db";

interface DomainSummary {
  domain: string;
  total: number;
  open: number;
  blocked: number;
  recent_change: {
    content: string;
    change_category: string;
    entity_type: string;
  } | null;
}

/**
 * GET /api/dashboard/summary — Single aggregation endpoint for the dashboard.
 * Returns health score, entity counters with trends, domain summaries, and attention queue.
 */
export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const entityStats = getEntityStats();
    const latestSnapshot = getLatestSnapshot();
    const recentSnapshots = getRecentSnapshots(2);
    const previousSnapshot = recentSnapshots.length > 1 ? recentSnapshots[1] : null;

    // --- Health Score ---
    const totalEntities = entityStats.total;
    const resolvedCount = entityStats.byStatus["resolved"] ?? 0;
    const healthScore = totalEntities > 0
      ? Math.round((resolvedCount / totalEntities) * 100)
      : 0;

    // Previous health score for trend
    let previousHealthScore: number | null = null;
    if (previousSnapshot?.entity_summary) {
      try {
        const prevSummary = JSON.parse(previousSnapshot.entity_summary);
        const prevTotal = prevSummary.total ?? 0;
        const prevResolved = prevSummary.byStatus?.resolved ?? 0;
        previousHealthScore = prevTotal > 0 ? Math.round((prevResolved / prevTotal) * 100) : 0;
      } catch { /* ignore parse errors */ }
    }

    // --- Entity Counters with Trends ---
    const currentCounts = {
      decisions: entityStats.byType["decision"] ?? 0,
      gaps: entityStats.byType["gap"] ?? 0,
      dependencies: entityStats.byType["dependency"] ?? 0,
      stakeholders: entityStats.byType["stakeholder"] ?? 0,
      milestones: entityStats.byType["milestone"] ?? 0,
      workflows: entityStats.byType["workflow"] ?? 0,
    };

    let previousCounts: Record<string, number> | null = null;
    if (previousSnapshot?.entity_summary) {
      try {
        const prevSummary = JSON.parse(previousSnapshot.entity_summary);
        if (prevSummary.byType) {
          previousCounts = {
            decisions: prevSummary.byType["decision"] ?? 0,
            gaps: prevSummary.byType["gap"] ?? 0,
            dependencies: prevSummary.byType["dependency"] ?? 0,
            stakeholders: prevSummary.byType["stakeholder"] ?? 0,
            milestones: prevSummary.byType["milestone"] ?? 0,
            workflows: prevSummary.byType["workflow"] ?? 0,
          };
        }
      } catch { /* ignore */ }
    }

    // --- Open Gaps Count ---
    const openGaps = (db.prepare(
      "SELECT COUNT(*) as count FROM entities WHERE entity_type = 'gap' AND status = 'open'"
    ).get() as { count: number }).count;

    // --- Domain Summaries ---
    const domainRows = db.prepare(
      `SELECT domain, COUNT(*) as total,
              SUM(CASE WHEN status IN ('open', 'blocked') THEN 1 ELSE 0 END) as open_count,
              SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) as blocked_count
       FROM entities
       WHERE domain != ''
       GROUP BY domain
       ORDER BY total DESC`
    ).all() as Array<{ domain: string; total: number; open_count: number; blocked_count: number }>;

    // Parse change delta for recent changes per domain
    let changeDeltaChanges: Array<{
      content: string;
      change_category: string;
      entity_type: string;
      domain: string;
    }> = [];
    if (latestSnapshot?.change_delta) {
      try {
        const delta = JSON.parse(latestSnapshot.change_delta);
        changeDeltaChanges = delta.changes ?? [];
      } catch { /* ignore */ }
    }

    const domainSummaries: DomainSummary[] = domainRows.map((row) => {
      const domainChange = changeDeltaChanges.find(
        (c) => c.domain === row.domain && c.change_category !== "unchanged"
      );
      return {
        domain: row.domain,
        total: row.total,
        open: row.open_count,
        blocked: row.blocked_count,
        recent_change: domainChange
          ? {
              content: domainChange.content,
              change_category: domainChange.change_category,
              entity_type: domainChange.entity_type,
            }
          : null,
      };
    });

    // --- Recent Changes (from latest snapshot change_delta) ---
    const recentChanges = changeDeltaChanges
      .filter((c) => c.change_category !== "unchanged")
      .slice(0, 20);

    // --- Attention Queue ---
    // 1. Dependencies with no owner (high severity)
    const unownedDeps = db.prepare(
      `SELECT e.id, e.entity_type, e.content, e.domain, e.status
       FROM entities e
       WHERE e.entity_type = 'dependency' AND e.owner IS NULL
       ORDER BY e.first_seen_at DESC
       LIMIT 10`
    ).all() as Array<{ id: number; entity_type: string; content: string; domain: string; status: string }>;

    // 2. Open gaps older than 14 days (medium severity)
    const staleGaps = db.prepare(
      `SELECT e.id, e.entity_type, e.content, e.domain, e.status, e.first_seen_at
       FROM entities e
       WHERE e.entity_type = 'gap'
         AND e.status = 'open'
         AND e.first_seen_at <= datetime('now', '-14 days')
       ORDER BY e.first_seen_at ASC
       LIMIT 10`
    ).all() as Array<{ id: number; entity_type: string; content: string; domain: string; status: string; first_seen_at: string }>;

    const attentionQueue = [
      ...unownedDeps.map((d) => ({
        id: d.id,
        entity_type: d.entity_type,
        content: d.content,
        domain: d.domain,
        severity: "high" as const,
        reason: "No owner assigned",
      })),
      ...staleGaps.map((g) => ({
        id: g.id,
        entity_type: g.entity_type,
        content: g.content,
        domain: g.domain,
        severity: "medium" as const,
        reason: `Open for ${Math.floor((Date.now() - new Date(g.first_seen_at).getTime()) / 86400000)} days`,
      })),
    ];

    // --- Last Indexed ---
    const lastIndexedAt = latestSnapshot?.created_at ?? null;

    return new Response(
      JSON.stringify({
        health_score: healthScore,
        previous_health_score: previousHealthScore,
        entity_counts: currentCounts,
        previous_entity_counts: previousCounts,
        open_gaps: openGaps,
        total_entities: totalEntities,
        domain_summaries: domainSummaries,
        recent_changes: recentChanges,
        attention_queue: attentionQueue,
        last_indexed_at: lastIndexedAt,
        has_entities: totalEntities > 0,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[dashboard/summary] Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
