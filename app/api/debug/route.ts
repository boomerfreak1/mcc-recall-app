import { extractEntities } from "@/lib/ai";
import { getEntityStats } from "@/lib/storage";

export const dynamic = "force-dynamic";

const TEST_TEXT = `Paul Ambraz described the aspirational future state: "Don't do these 52 tactics. Do these 102 tactics." The team decided to use AI-optimized tactic mix planning instead of leader-driven budget allocation. [GAP] Who owns the brand/legal clearance automation currently in POC?`;

/**
 * GET /api/debug — Test extraction pipeline and show entity stats.
 * Hit this endpoint after deploying to verify Mistral extraction works.
 */
export async function GET() {
  const stats = getEntityStats();

  const mistralKey = process.env.MISTRAL_API_KEY;
  const mistralModel = process.env.MISTRAL_MODEL ?? "mistral-small-latest";

  let extractionResult: { entities: unknown[]; error?: string } = { entities: [] };
  try {
    const entities = await extractEntities(TEST_TEXT);
    extractionResult = { entities };
  } catch (error) {
    extractionResult = {
      entities: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return Response.json({
    db_entity_stats: stats,
    mistral_configured: !!mistralKey,
    mistral_key_prefix: mistralKey ? mistralKey.substring(0, 8) + "..." : null,
    mistral_model: mistralModel,
    mistral_usage: mistralKey ? "extraction + classification + chat" : "not configured (using Ollama)",
    test_extraction: extractionResult,
  });
}
