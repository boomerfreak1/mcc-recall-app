import { NextResponse } from "next/server";
import { runFullIndex } from "@/lib/indexing";

/**
 * POST /api/index — Trigger full indexing pipeline.
 * Pulls all files from GitHub, parses, chunks, embeds, and stores.
 */
export async function POST() {
  try {
    const result = await runFullIndex((progress) => {
      console.log(
        `[index] ${progress.phase} (${progress.current}/${progress.total}): ${progress.message}`
      );
    });

    return NextResponse.json({
      success: true,
      ...result,
      duration: `${(result.duration / 1000).toFixed(1)}s`,
    });
  } catch (error) {
    console.error("[index] Pipeline failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export const maxDuration = 300; // Allow up to 5 minutes for indexing
