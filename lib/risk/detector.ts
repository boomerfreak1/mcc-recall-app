/**
 * Phase 3: Risk Radar — Proactive risk detection engine.
 *
 * 6 rule types that scan extracted entities and relations to surface risks:
 * 1. Stale Gap (high) — open gaps in domains with no doc updates for 14+ days
 * 2. Ownerless Dependency (high) — dependencies where owner is null
 * 3. Contradictory Decisions (critical) — semantically similar decisions confirmed by LLM
 * 4. Orphaned Milestone (medium) — milestones with no relations to deps/workflows
 * 5. Ownership Concentration (medium) — single owner holds >40% of domain's open items
 * 6. Stale Decision (low) — decisions >30 days old with no related entities having recent activity
 */

import { getDb } from "../storage/db";
import type { EntityRow, RiskItemRow } from "../storage/db";
import {
  insertRiskItem,
  getActiveRiskByTypeAndEntity,
} from "../storage";
import { getEmbeddingProvider } from "../embeddings";

const DEFAULT_BASE_URL = "http://localhost:11434";

export interface RiskDetectionResult {
  risks_detected: number;
  by_type: Record<string, number>;
  by_severity: Record<string, number>;
  duration_ms: number;
}

/**
 * Upsert a risk — skip if an active risk with same type+entity already exists.
 */
function upsertRisk(item: {
  entity_id: number | null;
  risk_type: string;
  severity: string;
  description: string;
  suggested_action: string | null;
}): RiskItemRow | null {
  if (item.entity_id) {
    const existing = getActiveRiskByTypeAndEntity(item.risk_type, item.entity_id);
    if (existing) return null;
  }
  return insertRiskItem(item);
}

// --- Rule 1: Stale Gap ---

function detectStaleGaps(): number {
  const db = getDb();
  const staleGaps = db
    .prepare(
      `SELECT e.id, e.content, e.domain, e.first_seen_at
       FROM entities e
       WHERE e.entity_type = 'gap'
         AND e.status = 'open'
         AND e.first_seen_at <= datetime('now', '-14 days')`
    )
    .all() as Array<Pick<EntityRow, "id" | "content" | "domain" | "first_seen_at">>;

  let count = 0;
  for (const gap of staleGaps) {
    const result = upsertRisk({
      entity_id: gap.id,
      risk_type: "stale_gap",
      severity: "high",
      description: `Open gap in "${gap.domain}" has been unresolved for 14+ days: "${gap.content.substring(0, 120)}"`,
      suggested_action: `Review and either resolve or assign an owner to this gap. Domain: ${gap.domain}`,
    });
    if (result) count++;
  }
  return count;
}

// --- Rule 2: Ownerless Dependency ---

function detectOwnerlessDependencies(): number {
  const db = getDb();
  const ownerless = db
    .prepare(
      `SELECT e.id, e.content, e.domain, e.status
       FROM entities e
       WHERE e.entity_type = 'dependency'
         AND e.owner IS NULL
         AND e.status != 'resolved'`
    )
    .all() as Array<Pick<EntityRow, "id" | "content" | "domain" | "status">>;

  let count = 0;
  for (const dep of ownerless) {
    const result = upsertRisk({
      entity_id: dep.id,
      risk_type: "ownerless_dependency",
      severity: "high",
      description: `Dependency with no owner in "${dep.domain}": "${dep.content.substring(0, 120)}"`,
      suggested_action: `Assign an owner to this dependency to ensure accountability. Status: ${dep.status}`,
    });
    if (result) count++;
  }
  return count;
}

// --- Rule 3: Contradictory Decisions ---

async function detectContradictoryDecisions(): Promise<number> {
  const db = getDb();
  const decisions = db
    .prepare(
      `SELECT e.id, e.content, e.domain
       FROM entities e
       WHERE e.entity_type = 'decision'
         AND e.status != 'resolved'
       ORDER BY e.id`
    )
    .all() as Array<Pick<EntityRow, "id" | "content" | "domain">>;

  if (decisions.length < 2) return 0;

  // Embed all decisions and find highly similar pairs
  const embedder = getEmbeddingProvider();
  const contents = decisions.map((d) => d.content);

  let embeddings: number[][];
  try {
    const results = await embedder.generateEmbeddings(contents);
    embeddings = results.map((r) => r.embedding);
  } catch {
    console.warn("[risk] Failed to embed decisions for contradiction check, skipping");
    return 0;
  }

  // Find pairs with high similarity (>0.82) — candidates for contradiction
  const candidates: Array<{ i: number; j: number; similarity: number }> = [];
  for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      const sim = cosineSimilarity(embeddings[i], embeddings[j]);
      if (sim > 0.82 && sim < 0.98) {
        // Similar but not identical
        candidates.push({ i, j, similarity: sim });
      }
    }
  }

  if (candidates.length === 0) return 0;

  // LLM confirmation for top candidates (limit to 5 to avoid excessive calls)
  let count = 0;
  const topCandidates = candidates
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5);

  for (const pair of topCandidates) {
    const d1 = decisions[pair.i];
    const d2 = decisions[pair.j];

    try {
      const isContradiction = await confirmContradiction(d1.content, d2.content);
      if (isContradiction) {
        // Create risk for first decision
        const r1 = upsertRisk({
          entity_id: d1.id,
          risk_type: "contradictory_decisions",
          severity: "critical",
          description: `Potentially contradictory decisions found:\n1. "${d1.content.substring(0, 100)}"\n2. "${d2.content.substring(0, 100)}"`,
          suggested_action: `Review both decisions and reconcile. Domains: ${d1.domain}, ${d2.domain}`,
        });
        // Create risk for second decision too
        const r2 = upsertRisk({
          entity_id: d2.id,
          risk_type: "contradictory_decisions",
          severity: "critical",
          description: `Potentially contradictory decisions found:\n1. "${d1.content.substring(0, 100)}"\n2. "${d2.content.substring(0, 100)}"`,
          suggested_action: `Review both decisions and reconcile. Domains: ${d1.domain}, ${d2.domain}`,
        });
        if (r1) count++;
        if (r2) count++;
      }
    } catch {
      // LLM call failed, skip this pair
    }
  }

  return count;
}

/**
 * Ask the LLM whether two decisions contradict each other.
 */
async function confirmContradiction(decision1: string, decision2: string): Promise<boolean> {
  const baseUrl = (process.env.OLLAMA_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const model = process.env.OLLAMA_EXTRACTION_MODEL ?? process.env.OLLAMA_CHAT_MODEL ?? "llama3.2:3b";

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "You are a project analyst. Answer ONLY with YES or NO.",
        },
        {
          role: "user",
          content: `Do these two project decisions contradict each other?\n\nDecision 1: "${decision1}"\n\nDecision 2: "${decision2}"\n\nAnswer YES if they are contradictory or conflicting, NO if they are compatible or unrelated.`,
        },
      ],
      stream: false,
      options: { temperature: 0.1, num_predict: 10 },
    }),
  });

  if (!response.ok) return false;
  const data = await response.json();
  const answer = (data.message?.content ?? "").trim().toUpperCase();
  return answer.startsWith("YES");
}

// --- Rule 4: Orphaned Milestone ---

function detectOrphanedMilestones(): number {
  const db = getDb();
  // Milestones that have zero relations to any other entity
  const orphaned = db
    .prepare(
      `SELECT e.id, e.content, e.domain
       FROM entities e
       WHERE e.entity_type = 'milestone'
         AND e.status != 'resolved'
         AND e.id NOT IN (
           SELECT source_entity_id FROM entity_relations
           UNION
           SELECT target_entity_id FROM entity_relations
         )`
    )
    .all() as Array<Pick<EntityRow, "id" | "content" | "domain">>;

  let count = 0;
  for (const ms of orphaned) {
    const result = upsertRisk({
      entity_id: ms.id,
      risk_type: "orphaned_milestone",
      severity: "medium",
      description: `Milestone with no linked dependencies or workflows in "${ms.domain}": "${ms.content.substring(0, 120)}"`,
      suggested_action: `Connect this milestone to relevant dependencies or workflows, or verify it's still needed.`,
    });
    if (result) count++;
  }
  return count;
}

// --- Rule 5: Ownership Concentration ---

function detectOwnershipConcentration(): number {
  const db = getDb();
  // Get open items per domain+owner
  const domainOwnerCounts = db
    .prepare(
      `SELECT domain, owner, COUNT(*) as count
       FROM entities
       WHERE status IN ('open', 'blocked')
         AND owner IS NOT NULL
         AND owner != ''
       GROUP BY domain, owner`
    )
    .all() as Array<{ domain: string; owner: string; count: number }>;

  // Get total open items per domain
  const domainTotals = db
    .prepare(
      `SELECT domain, COUNT(*) as count
       FROM entities
       WHERE status IN ('open', 'blocked')
       GROUP BY domain`
    )
    .all() as Array<{ domain: string; count: number }>;

  const totalMap = new Map<string, number>();
  for (const row of domainTotals) {
    totalMap.set(row.domain, row.count);
  }

  let count = 0;
  for (const row of domainOwnerCounts) {
    const total = totalMap.get(row.domain) ?? 0;
    if (total >= 5 && row.count / total > 0.4) {
      // Find one entity from this owner to link the risk to
      const sampleEntity = db
        .prepare(
          `SELECT id FROM entities WHERE domain = ? AND owner = ? AND status IN ('open', 'blocked') LIMIT 1`
        )
        .get(row.domain, row.owner) as { id: number } | undefined;

      const result = upsertRisk({
        entity_id: sampleEntity?.id ?? null,
        risk_type: "ownership_concentration",
        severity: "medium",
        description: `"${row.owner}" owns ${row.count}/${total} (${Math.round((row.count / total) * 100)}%) of open items in "${row.domain}"`,
        suggested_action: `Distribute ownership more evenly in ${row.domain} to reduce single-point-of-failure risk.`,
      });
      if (result) count++;
    }
  }
  return count;
}

// --- Rule 6: Stale Decision ---

function detectStaleDecisions(): number {
  const db = getDb();
  const staleDecisions = db
    .prepare(
      `SELECT e.id, e.content, e.domain, e.first_seen_at
       FROM entities e
       WHERE e.entity_type = 'decision'
         AND e.status != 'resolved'
         AND e.first_seen_at <= datetime('now', '-30 days')
         AND e.id NOT IN (
           SELECT er.source_entity_id FROM entity_relations er
           JOIN entities e2 ON er.target_entity_id = e2.id
           WHERE e2.last_seen_at > datetime('now', '-14 days')
           UNION
           SELECT er.target_entity_id FROM entity_relations er
           JOIN entities e2 ON er.source_entity_id = e2.id
           WHERE e2.last_seen_at > datetime('now', '-14 days')
         )`
    )
    .all() as Array<Pick<EntityRow, "id" | "content" | "domain" | "first_seen_at">>;

  let count = 0;
  for (const dec of staleDecisions) {
    const result = upsertRisk({
      entity_id: dec.id,
      risk_type: "stale_decision",
      severity: "low",
      description: `Decision in "${dec.domain}" is 30+ days old with no recent related activity: "${dec.content.substring(0, 120)}"`,
      suggested_action: `Verify this decision is still current and relevant, or mark as resolved if superseded.`,
    });
    if (result) count++;
  }
  return count;
}

// --- Utility ---

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

// --- Main Entry Point ---

/**
 * Run all risk detection rules against the current entity corpus.
 * Called after entity extraction and change detection in the indexing pipeline.
 */
export async function runRiskDetection(): Promise<RiskDetectionResult> {
  const startTime = Date.now();
  const counts: Record<string, number> = {};
  const severityCounts: Record<string, number> = {};

  console.log("[risk] Starting risk detection...");

  // Rule 1: Stale Gaps
  try {
    counts.stale_gap = detectStaleGaps();
    console.log(`[risk] Stale gaps: ${counts.stale_gap}`);
  } catch (err) {
    console.warn("[risk] Stale gap detection failed:", err instanceof Error ? err.message : err);
    counts.stale_gap = 0;
  }

  // Rule 2: Ownerless Dependencies
  try {
    counts.ownerless_dependency = detectOwnerlessDependencies();
    console.log(`[risk] Ownerless dependencies: ${counts.ownerless_dependency}`);
  } catch (err) {
    console.warn("[risk] Ownerless dependency detection failed:", err instanceof Error ? err.message : err);
    counts.ownerless_dependency = 0;
  }

  // Rule 3: Contradictory Decisions (async — requires LLM)
  try {
    counts.contradictory_decisions = await detectContradictoryDecisions();
    console.log(`[risk] Contradictory decisions: ${counts.contradictory_decisions}`);
  } catch (err) {
    console.warn("[risk] Contradictory decision detection failed:", err instanceof Error ? err.message : err);
    counts.contradictory_decisions = 0;
  }

  // Rule 4: Orphaned Milestones
  try {
    counts.orphaned_milestone = detectOrphanedMilestones();
    console.log(`[risk] Orphaned milestones: ${counts.orphaned_milestone}`);
  } catch (err) {
    console.warn("[risk] Orphaned milestone detection failed:", err instanceof Error ? err.message : err);
    counts.orphaned_milestone = 0;
  }

  // Rule 5: Ownership Concentration
  try {
    counts.ownership_concentration = detectOwnershipConcentration();
    console.log(`[risk] Ownership concentration: ${counts.ownership_concentration}`);
  } catch (err) {
    console.warn("[risk] Ownership concentration detection failed:", err instanceof Error ? err.message : err);
    counts.ownership_concentration = 0;
  }

  // Rule 6: Stale Decisions
  try {
    counts.stale_decision = detectStaleDecisions();
    console.log(`[risk] Stale decisions: ${counts.stale_decision}`);
  } catch (err) {
    console.warn("[risk] Stale decision detection failed:", err instanceof Error ? err.message : err);
    counts.stale_decision = 0;
  }

  // Tally severities
  const severityMap: Record<string, string> = {
    stale_gap: "high",
    ownerless_dependency: "high",
    contradictory_decisions: "critical",
    orphaned_milestone: "medium",
    ownership_concentration: "medium",
    stale_decision: "low",
  };

  for (const [type, c] of Object.entries(counts)) {
    const sev = severityMap[type] ?? "medium";
    severityCounts[sev] = (severityCounts[sev] ?? 0) + c;
  }

  const totalDetected = Object.values(counts).reduce((a, b) => a + b, 0);
  const duration = Date.now() - startTime;

  console.log(`[risk] Detection complete: ${totalDetected} risks in ${duration}ms`);

  return {
    risks_detected: totalDetected,
    by_type: counts,
    by_severity: severityCounts,
    duration_ms: duration,
  };
}
