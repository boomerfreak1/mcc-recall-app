import { NextRequest } from "next/server";
import { getEntities, getEntityStats } from "@/lib/storage";

/**
 * GET /api/entities — List all entities with optional filters.
 * Query params: type, domain, status, owner
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") ?? undefined;
    const domain = searchParams.get("domain") ?? undefined;
    const status = searchParams.get("status") ?? undefined;
    const owner = searchParams.get("owner") ?? undefined;

    const entities = getEntities({ type, domain, status, owner });
    const stats = getEntityStats();

    return new Response(
      JSON.stringify({ entities, stats }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[entities] Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
