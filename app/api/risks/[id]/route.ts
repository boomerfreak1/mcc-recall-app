import { NextRequest } from "next/server";
import { getRiskById, getEntityById, dismissRisk } from "@/lib/storage";

/**
 * GET /api/risks/[id] — Get a single risk item with its linked entity.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const riskId = parseInt(id, 10);
    if (isNaN(riskId)) {
      return Response.json({ error: "Invalid risk ID" }, { status: 400 });
    }

    const risk = getRiskById(riskId);
    if (!risk) {
      return Response.json({ error: "Risk not found" }, { status: 404 });
    }

    const entity = risk.entity_id ? getEntityById(risk.entity_id) : null;

    return Response.json({ risk, entity });
  } catch (error) {
    console.error("[risks] Error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

/**
 * POST /api/risks/[id] — Dismiss a risk item.
 * Body: { action: "dismiss" }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const riskId = parseInt(id, 10);
    if (isNaN(riskId)) {
      return Response.json({ error: "Invalid risk ID" }, { status: 400 });
    }

    const risk = getRiskById(riskId);
    if (!risk) {
      return Response.json({ error: "Risk not found" }, { status: 404 });
    }

    const body = await request.json();
    if (body.action === "dismiss") {
      dismissRisk(riskId);
      return Response.json({ success: true, message: "Risk dismissed" });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("[risks] Error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
