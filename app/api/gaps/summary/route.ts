import { getGapStats } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * GET /api/gaps/summary — Aggregate gap stats.
 */
export async function GET() {
  try {
    const stats = getGapStats();
    return Response.json(stats);
  } catch (error) {
    console.error("[api/gaps/summary] Error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
