import { importGapsFromExcel } from "@/lib/gaps";

export const dynamic = "force-dynamic";

/**
 * POST /api/gaps/import — Trigger re-import from Excel file.
 */
export async function POST() {
  try {
    const result = await importGapsFromExcel();
    return Response.json(result);
  } catch (error) {
    console.error("[api/gaps/import] Error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
