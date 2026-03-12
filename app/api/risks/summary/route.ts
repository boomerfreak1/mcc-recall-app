import { getRiskItems, getRiskStats, getRecentSnapshots } from "@/lib/storage";
import { getDb } from "@/lib/storage/db";
import { computeHealthScores } from "@/lib/risk";

/**
 * GET /api/risks/summary — Aggregated risk data for the dashboard.
 * Returns: active risk counts by severity, top 5 risks for attention queue,
 * risk count trend over last 5 snapshots, and overall health score.
 */
export async function GET() {
  try {
    const stats = getRiskStats();

    // Top 5 active risks (sorted by severity, then oldest first)
    const allActive = getRiskItems({ active_only: true });
    const top5 = allActive.slice(0, 5);

    // Enrich top 5 with entity domain info
    const db = getDb();
    const enriched = top5.map((risk) => {
      let domain = "";
      if (risk.entity_id) {
        const entity = db
          .prepare("SELECT domain, entity_type, content, status, owner FROM entities WHERE id = ?")
          .get(risk.entity_id) as { domain: string; entity_type: string; content: string; status: string; owner: string | null } | undefined;
        if (entity) {
          domain = entity.domain;
        }
      }
      return {
        id: risk.id,
        risk_type: risk.risk_type,
        severity: risk.severity,
        description: risk.description,
        detected_at: risk.detected_at,
        domain,
      };
    });

    // Risk count trend over last 5 snapshots
    const snapshots = getRecentSnapshots(5);
    const trend = snapshots.reverse().map((snap) => {
      // Count risks that were active at this snapshot's time:
      // detected_at <= snap.created_at AND (resolved_at IS NULL OR resolved_at > snap.created_at)
      // AND (dismissed_at IS NULL OR dismissed_at > snap.created_at)
      const row = db
        .prepare(
          `SELECT COUNT(*) as count FROM risk_items
           WHERE detected_at <= ?
             AND (resolved_at IS NULL OR resolved_at > ?)
             AND (dismissed_at IS NULL OR dismissed_at > ?)`
        )
        .get(snap.created_at, snap.created_at, snap.created_at) as { count: number };

      return {
        snapshot_id: snap.id,
        created_at: snap.created_at,
        active_risks: row.count,
      };
    });

    // Health score
    let healthScore = 0;
    try {
      const health = computeHealthScores();
      healthScore = health.overall_score;
    } catch { /* fallback */ }

    // Count critical risks for nav badge
    const criticalCount = stats.bySeverity["critical"] ?? 0;

    return Response.json({
      stats,
      top_risks: enriched,
      trend,
      health_score: healthScore,
      critical_count: criticalCount,
    });
  } catch (error) {
    console.error("[risks/summary] Error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
