import { NextRequest } from "next/server";
import { getLatestSnapshot } from "@/lib/storage";
import { getDb } from "@/lib/storage/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/summary — Document + gap focused dashboard API.
 */
export async function GET(request: NextRequest) {
  try {
    const db = getDb();

    // Documents
    const documents = db.prepare(
      "SELECT id, title, domain, format, indexed_at FROM documents ORDER BY indexed_at DESC LIMIT 10"
    ).all() as Array<{ id: number; title: string; domain: string; format: string; indexed_at: string }>;

    const documentCount = (db.prepare(
      "SELECT COUNT(*) as count FROM documents"
    ).get() as { count: number }).count;

    const domainCount = (db.prepare(
      "SELECT COUNT(DISTINCT domain) as count FROM documents WHERE domain != ''"
    ).get() as { count: number }).count;

    // Workflow count from gaps table
    let workflowCount = 0;
    try {
      workflowCount = (db.prepare(
        "SELECT COUNT(DISTINCT workflow_name) as count FROM gaps"
      ).get() as { count: number }).count;
    } catch { /* gaps table may not exist yet */ }

    // Gap summary by domain + workflow
    let gapSummary: Array<{
      domain: string;
      workflows: Array<{ workflow_name: string; gap_count: number; open_count: number }>;
      total_gaps: number;
    }> = [];
    let gapTotals = { total: 0, open: 0, in_progress: 0, resolved: 0 };

    try {
      const gapRows = db.prepare(
        `SELECT domain, workflow_name, COUNT(*) as gap_count,
                SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) as open_count
         FROM gaps GROUP BY domain, workflow_name ORDER BY domain, gap_count DESC`
      ).all() as Array<{ domain: string; workflow_name: string; gap_count: number; open_count: number }>;

      // Group by domain
      const domainMap = new Map<string, Array<{ workflow_name: string; gap_count: number; open_count: number }>>();
      for (const row of gapRows) {
        if (!domainMap.has(row.domain)) domainMap.set(row.domain, []);
        domainMap.get(row.domain)!.push({
          workflow_name: row.workflow_name,
          gap_count: row.gap_count,
          open_count: row.open_count,
        });
      }
      gapSummary = Array.from(domainMap.entries()).map(([domain, workflows]) => ({
        domain,
        workflows,
        total_gaps: workflows.reduce((sum, w) => sum + w.gap_count, 0),
      }));

      // Status totals
      const statusRows = db.prepare(
        "SELECT status, COUNT(*) as count FROM gaps GROUP BY status"
      ).all() as Array<{ status: string; count: number }>;

      for (const row of statusRows) {
        gapTotals.total += row.count;
        if (row.status === "open") gapTotals.open = row.count;
        else if (row.status === "in-progress") gapTotals.in_progress = row.count;
        else if (row.status === "resolved") gapTotals.resolved = row.count;
      }
    } catch { /* gaps table may not exist yet */ }

    // Last indexed
    const latestSnapshot = getLatestSnapshot();
    const lastIndexedAt = latestSnapshot?.created_at ?? null;

    return Response.json({
      documents,
      document_count: documentCount,
      domain_count: domainCount,
      workflow_count: workflowCount,
      gap_summary: gapSummary,
      gap_totals: gapTotals,
      last_indexed_at: lastIndexedAt,
    });
  } catch (error) {
    console.error("[dashboard/summary] Error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
