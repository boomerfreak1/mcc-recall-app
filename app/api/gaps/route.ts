import { NextRequest } from "next/server";
import { getGaps, getGapStats } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * GET /api/gaps — List gaps with optional filters.
 * Query params: domain, workflow, gap_type, status
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const domain = searchParams.get("domain") || undefined;
    const workflow_name = searchParams.get("workflow") || undefined;
    const gap_type = searchParams.get("gap_type") || undefined;
    const status = searchParams.get("status") || undefined;

    const gaps = getGaps({ domain, workflow_name, gap_type, status });
    const stats = getGapStats();

    return Response.json({ gaps, stats });
  } catch (error) {
    console.error("[api/gaps] Error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
