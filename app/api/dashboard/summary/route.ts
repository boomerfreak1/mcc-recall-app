import { NextRequest } from "next/server";
import {
  getEntityStats,
  getLatestSnapshot,
  getRecentSnapshots,
} from "@/lib/storage";
import { getDb } from "@/lib/storage/db";
import { computeHealthScores } from "@/lib/risk";
import type { HealthScoreResult } from "@/lib/risk";

interface DomainSummary {
  domain: string;
  total: number;
  open: number;
  blocked: number;
  health_score: number | null;
  recent_change: {
    content: string;
    change_category: string;
    entity_type: string;
  } | null;
}

/**
 * GET /api/dashboard/summary — Single aggregation endpoint for the dashboard.
 * Returns weighted health score, entity counters with trends, domain summaries, and attention queue.
 */
export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const entityStats = getEntityStats();
    const latestSnapshot = getLatestSnapshot();
    const recentSnapshots = getRecentSnapshots(2);
    const previousSnapshot = recentSnapshots.length > 1 ? recentSnapshots[1] : null;

    // --- Weighted Health Score ---
    let healthResult: HealthScoreResult;
    try {
      healthResult = computeHealthScores();
    } catch {
      // Fallback if health computation fails
      healthResult = {
        overall_score: 0,
        domains: [],
        factors: {
          gap_resolution: 0,
          dependency_coverage: 0,
          decision_freshness: 0,
          ownership_distribution: 0,
        },
      };
    }

    // Previous health score for trend
    let previousHealthScore: number | null = null;
    if (previousSnapshot?.health_scores) {
      try {
        const prev = JSON.parse(previousSnapshot.health_scores);
        previousHealthScore = prev.overall_score ?? null;
      } catch { /* ignore */ }
    }
    // Fallback: try old-style calculation from entity_summary
    if (previousHealthScore === null && previousSnapshot?.entity_summary) {
      try {
        const prevSummary = JSON.parse(previousSnapshot.entity_summary);
        const prevTotal = prevSummary.total ?? 0;
        const prevResolved = prevSummary.byStatus?.resolved ?? 0;
        previousHealthScore = prevTotal > 0 ? Math.round((prevResolved / prevTotal) * 100) : 0;
      } catch { /* ignore */ }
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

    // --- Domain Summaries with Health Scores ---
    const domainRows = db.prepare(
      `SELECT domain, COUNT(*) as total,
              SUM(CASE WHEN status IN ('open', 'blocked') THEN 1 ELSE 0 END) as open_count,
              SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) as blocked_count
       FROM entities
       WHERE domain != ''
       GROUP BY domain
       ORDER BY total DESC`
    ).all() as Array<{ domain: string; total: number; open_count: number; blocked_count: number }>;

    // Build domain health lookup
    const domainHealthMap = new Map<string, number>();
    for (const dh of healthResult.domains) {
      domainHealthMap.set(dh.domain, dh.score);
    }

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
        health_score: domainHealthMap.get(row.domain) ?? null,
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

    // --- Attention Queue (from risk_items) ---
    const topRisks = db.prepare(
      `SELECT ri.id, ri.risk_type, ri.severity, ri.description, ri.detected_at, ri.entity_id,
              COALESCE(e.domain, '') as domain
       FROM risk_items ri
       LEFT JOIN entities e ON ri.entity_id = e.id
       WHERE ri.resolved_at IS NULL AND ri.dismissed_at IS NULL
       ORDER BY CASE ri.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
                ri.detected_at ASC
       LIMIT 5`
    ).all() as Array<{ id: number; risk_type: string; severity: string; description: string; detected_at: string; entity_id: number | null; domain: string }>;

    const attentionQueue = topRisks.map((r) => ({
      id: r.id,
      risk_type: r.risk_type,
      severity: r.severity as "critical" | "high" | "medium" | "low",
      description: r.description,
      domain: r.domain,
      detected_at: r.detected_at,
    }));

    // Critical risk count for nav badge
    const criticalCount = (db.prepare(
      "SELECT COUNT(*) as count FROM risk_items WHERE severity = 'critical' AND resolved_at IS NULL AND dismissed_at IS NULL"
    ).get() as { count: number }).count;

    const totalActiveRisks = (db.prepare(
      "SELECT COUNT(*) as count FROM risk_items WHERE resolved_at IS NULL AND dismissed_at IS NULL"
    ).get() as { count: number }).count;

    // --- Last Indexed ---
    const lastIndexedAt = latestSnapshot?.created_at ?? null;
    const totalEntities = entityStats.total;

    return Response.json({
      health_score: healthResult.overall_score,
      health_factors: healthResult.factors,
      health_domains: healthResult.domains,
      previous_health_score: previousHealthScore,
      entity_counts: currentCounts,
      previous_entity_counts: previousCounts,
      open_gaps: openGaps,
      total_entities: totalEntities,
      domain_summaries: domainSummaries,
      recent_changes: recentChanges,
      attention_queue: attentionQueue,
      critical_risk_count: criticalCount,
      total_active_risks: totalActiveRisks,
      last_indexed_at: lastIndexedAt,
      has_entities: totalEntities > 0,
    });
  } catch (error) {
    console.error("[dashboard/summary] Error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
