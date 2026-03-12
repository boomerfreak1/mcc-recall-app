import { NextRequest } from "next/server";
import { getRiskItems, getRiskStats } from "@/lib/storage";

/**
 * GET /api/risks — List risk items with optional filters.
 * Query params: severity, risk_type, active_only (default true)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const severity = searchParams.get("severity") ?? undefined;
    const risk_type = searchParams.get("risk_type") ?? undefined;
    const active_only = searchParams.get("active_only") !== "false";

    const risks = getRiskItems({ severity, risk_type, active_only });
    const stats = getRiskStats();

    return Response.json({ risks, stats });
  } catch (error) {
    console.error("[risks] Error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
