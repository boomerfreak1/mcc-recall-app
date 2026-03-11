import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

/**
 * GitHub webhook endpoint.
 * Receives push events and triggers re-indexing of changed files.
 *
 * Set GITHUB_WEBHOOK_SECRET env var to verify webhook signatures.
 */

interface GitHubPushPayload {
  ref: string;
  before: string;
  after: string;
  commits: Array<{
    id: string;
    message: string;
    added: string[];
    removed: string[];
    modified: string[];
  }>;
  repository: {
    full_name: string;
  };
  sender: {
    login: string;
  };
}

function verifySignature(
  payload: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) return false;

  const hmac = crypto.createHmac("sha256", secret);
  const digest = `sha256=${hmac.update(payload).digest("hex")}`;

  return crypto.timingSafeEqual(
    Buffer.from(digest),
    Buffer.from(signature)
  );
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const event = request.headers.get("x-github-event");
  const signature = request.headers.get("x-hub-signature-256");

  // Verify webhook signature if secret is configured
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (secret) {
    if (!verifySignature(body, signature, secret)) {
      return NextResponse.json(
        { error: "Invalid webhook signature" },
        { status: 401 }
      );
    }
  }

  // Only process push events
  if (event !== "push") {
    return NextResponse.json({ message: `Ignored event: ${event}` });
  }

  let payload: GitHubPushPayload;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 }
    );
  }

  // Collect all changed files from all commits
  const changedFiles = new Set<string>();
  const removedFiles = new Set<string>();

  for (const commit of payload.commits) {
    commit.added.forEach((f) => changedFiles.add(f));
    commit.modified.forEach((f) => changedFiles.add(f));
    commit.removed.forEach((f) => removedFiles.add(f));
  }

  // Remove files that were both added/modified and removed — net removal wins
  for (const f of removedFiles) {
    changedFiles.delete(f);
  }

  console.log(
    `[webhook] Push to ${payload.repository.full_name} by ${payload.sender.login}:`,
    {
      branch: payload.ref,
      changed: Array.from(changedFiles),
      removed: Array.from(removedFiles),
    }
  );

  // TODO: Trigger re-indexing pipeline for changed files
  // This will be implemented in Phase 1 when the indexing pipeline is built.

  return NextResponse.json({
    received: true,
    branch: payload.ref,
    changedFiles: Array.from(changedFiles),
    removedFiles: Array.from(removedFiles),
  });
}
