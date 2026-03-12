import { NextResponse } from "next/server";
import { runFullIndex } from "@/lib/indexing";

/**
 * Background indexing state.
 * Stored in module scope so the status endpoint can read it.
 */
let indexingState: {
  running: boolean;
  progress: { phase: string; current: number; total: number; message: string } | null;
  result: {
    success: boolean;
    documentsProcessed?: number;
    chunksCreated?: number;
    errors?: Array<{ file: string; error: string }>;
    duration?: string;
    error?: string;
  } | null;
  startedAt: string | null;
} = {
  running: false,
  progress: null,
  result: null,
  startedAt: null,
};

/**
 * POST /api/index — Trigger full indexing pipeline in the background.
 * Returns immediately with { started: true } and the client polls GET /api/index for status.
 */
export async function POST() {
  if (indexingState.running) {
    return NextResponse.json(
      { started: false, error: "Indexing already in progress", progress: indexingState.progress },
      { status: 409 }
    );
  }

  // Reset state and start background indexing
  indexingState = {
    running: true,
    progress: null,
    result: null,
    startedAt: new Date().toISOString(),
  };

  // Fire and forget — don't await
  runFullIndex((progress) => {
    indexingState.progress = progress;
    console.log(
      `[index] ${progress.phase} (${progress.current}/${progress.total}): ${progress.message}`
    );
  })
    .then((result) => {
      indexingState.running = false;
      indexingState.result = {
        success: true,
        ...result,
        duration: `${(result.duration / 1000).toFixed(1)}s`,
      };
      console.log(`[index] Pipeline complete: ${result.documentsProcessed} docs, ${result.chunksCreated} chunks in ${(result.duration / 1000).toFixed(1)}s`);
    })
    .catch((error) => {
      indexingState.running = false;
      indexingState.result = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
      console.error("[index] Pipeline failed:", error);
    });

  return NextResponse.json({ started: true, message: "Indexing started in background" });
}

/**
 * GET /api/index — Poll indexing status.
 */
export async function GET() {
  return NextResponse.json({
    running: indexingState.running,
    progress: indexingState.progress,
    result: indexingState.result,
    started_at: indexingState.startedAt,
  });
}

export const maxDuration = 600; // 10 minutes max for the route
