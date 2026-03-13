import { NextRequest } from "next/server";
import { updateGapStatus } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/gaps/:id — Update gap status (open → in-progress → resolved).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const gapId = parseInt(id, 10);
    if (isNaN(gapId)) {
      return Response.json({ error: "Invalid gap ID" }, { status: 400 });
    }

    const body = await request.json();
    const { status } = body;

    const validStatuses = ["open", "in-progress", "resolved"];
    if (!status || !validStatuses.includes(status)) {
      return Response.json(
        { error: `Status must be one of: ${validStatuses.join(", ")}` },
        { status: 400 }
      );
    }

    const updated = updateGapStatus(gapId, status);
    if (!updated) {
      return Response.json({ error: "Gap not found" }, { status: 404 });
    }

    return Response.json({ gap: updated });
  } catch (error) {
    console.error("[api/gaps/id] Error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
