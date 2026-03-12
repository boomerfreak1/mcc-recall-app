/**
 * Phase 3: Weighted Health Score Calculation.
 *
 * Four factors scored 0-100, computed per domain, rolled up to overall:
 *  - Gap Resolution Rate (30%): resolved gaps / total gaps
 *  - Dependency Coverage (25%): owned + known-status deps / total deps
 *  - Decision Freshness (20%): recency-weighted, penalized for contradictions
 *  - Ownership Distribution (25%): assignment rate + evenness
 */

import { getDb } from "../storage/db";

// --- Types ---

export interface FactorScores {
  gap_resolution: number;
  dependency_coverage: number;
  decision_freshness: number;
  ownership_distribution: number;
}

export interface DomainHealth {
  domain: string;
  score: number;
  entity_count: number;
  factors: FactorScores;
}

export interface HealthScoreResult {
  overall_score: number;
  domains: DomainHealth[];
  factors: FactorScores; // weighted average across all domains
}

// --- Factor Weights ---

const WEIGHTS = {
  gap_resolution: 0.3,
  dependency_coverage: 0.25,
  decision_freshness: 0.2,
  ownership_distribution: 0.25,
};

// --- Factor Implementations ---

/**
 * Gap Resolution Rate (weight: 30%)
 * Score = (resolved / total) * 100. No gaps = 100.
 */
function computeGapResolution(domain: string): number {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved
       FROM entities
       WHERE entity_type = 'gap' AND domain = ?`
    )
    .get(domain) as { total: number; resolved: number };

  if (row.total === 0) return 100;
  return Math.round((row.resolved / row.total) * 100);
}

/**
 * Dependency Coverage (weight: 25%)
 * Score = (deps with owner AND status != 'unknown') / total deps * 100. No deps = 100.
 */
function computeDependencyCoverage(domain: string): number {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN owner IS NOT NULL AND status != 'unknown' THEN 1 ELSE 0 END) as covered
       FROM entities
       WHERE entity_type = 'dependency' AND domain = ?`
    )
    .get(domain) as { total: number; covered: number };

  if (row.total === 0) return 100;
  return Math.round((row.covered / row.total) * 100);
}

/**
 * Decision Freshness (weight: 20%)
 * Recency-weighted: <=7d=100, 8-14d=75, 15-30d=50, >30d=25.
 * Subtract 20 if contradictory decision risks exist. No decisions = 50.
 */
function computeDecisionFreshness(domain: string): number {
  const db = getDb();
  const decisions = db
    .prepare(
      `SELECT first_seen_at FROM entities
       WHERE entity_type = 'decision' AND domain = ? AND status != 'resolved'`
    )
    .all(domain) as Array<{ first_seen_at: string }>;

  if (decisions.length === 0) return 50;

  const now = Date.now();
  let totalScore = 0;

  for (const d of decisions) {
    const ageMs = now - new Date(d.first_seen_at).getTime();
    const ageDays = ageMs / 86400000;

    if (ageDays <= 7) totalScore += 100;
    else if (ageDays <= 14) totalScore += 75;
    else if (ageDays <= 30) totalScore += 50;
    else totalScore += 25;
  }

  let score = Math.round(totalScore / decisions.length);

  // Check for contradictory decision risks in this domain
  const contradictions = db
    .prepare(
      `SELECT COUNT(*) as count FROM risk_items ri
       JOIN entities e ON ri.entity_id = e.id
       WHERE ri.risk_type = 'contradictory_decisions'
         AND e.domain = ?
         AND ri.resolved_at IS NULL
         AND ri.dismissed_at IS NULL`
    )
    .get(domain) as { count: number };

  if (contradictions.count > 0) {
    score = Math.max(0, score - 20);
  }

  return score;
}

/**
 * Ownership Distribution (weight: 25%)
 * Looks at assignable open entities (dependency, gap, milestone, workflow).
 * Penalizes unassigned items heavily. Caps at 60 if single owner >50%.
 */
function computeOwnershipDistribution(domain: string): number {
  const db = getDb();

  const items = db
    .prepare(
      `SELECT owner FROM entities
       WHERE domain = ?
         AND status IN ('open', 'blocked')
         AND entity_type IN ('dependency', 'gap', 'milestone', 'workflow')`
    )
    .all(domain) as Array<{ owner: string | null }>;

  if (items.length === 0) return 100;

  const totalItems = items.length;
  const assignedItems = items.filter((i) => i.owner !== null && i.owner !== "").length;
  const assignmentRate = assignedItems / totalItems;

  // Base score from assignment rate
  let score: number;
  if (assignmentRate >= 0.9) score = 100;
  else if (assignmentRate >= 0.7) score = 70 + (assignmentRate - 0.7) * 150; // 70-100
  else if (assignmentRate >= 0.5) score = 40 + (assignmentRate - 0.5) * 150; // 40-70
  else score = assignmentRate * 60; // 0-30 for <50% assigned

  // Check concentration: if any single owner holds >50% of items, cap at 60
  if (assignedItems > 0) {
    const ownerCounts = new Map<string, number>();
    for (const item of items) {
      if (item.owner) {
        ownerCounts.set(item.owner, (ownerCounts.get(item.owner) ?? 0) + 1);
      }
    }
    for (const count of ownerCounts.values()) {
      if (count / totalItems > 0.5) {
        score = Math.min(score, 60);
        break;
      }
    }
  }

  return Math.round(Math.min(100, Math.max(0, score)));
}

// --- Composite Calculation ---

/**
 * Compute the weighted composite score from four factor scores.
 */
function compositeScore(factors: FactorScores): number {
  return Math.round(
    factors.gap_resolution * WEIGHTS.gap_resolution +
    factors.dependency_coverage * WEIGHTS.dependency_coverage +
    factors.decision_freshness * WEIGHTS.decision_freshness +
    factors.ownership_distribution * WEIGHTS.ownership_distribution
  );
}

/**
 * Compute health scores for all domains and an overall project score.
 */
export function computeHealthScores(): HealthScoreResult {
  const db = getDb();

  // Get all domains with entity counts
  const domainRows = db
    .prepare(
      `SELECT domain, COUNT(*) as count
       FROM entities
       WHERE domain != ''
       GROUP BY domain
       ORDER BY count DESC`
    )
    .all() as Array<{ domain: string; count: number }>;

  if (domainRows.length === 0) {
    const neutralFactors: FactorScores = {
      gap_resolution: 100,
      dependency_coverage: 100,
      decision_freshness: 50,
      ownership_distribution: 100,
    };
    return {
      overall_score: compositeScore(neutralFactors),
      domains: [],
      factors: neutralFactors,
    };
  }

  const domains: DomainHealth[] = [];

  for (const row of domainRows) {
    const factors: FactorScores = {
      gap_resolution: computeGapResolution(row.domain),
      dependency_coverage: computeDependencyCoverage(row.domain),
      decision_freshness: computeDecisionFreshness(row.domain),
      ownership_distribution: computeOwnershipDistribution(row.domain),
    };

    domains.push({
      domain: row.domain,
      score: compositeScore(factors),
      entity_count: row.count,
      factors,
    });
  }

  // Overall: entity-count-weighted average of domain scores
  const totalEntities = domains.reduce((sum, d) => sum + d.entity_count, 0);
  const weightedOverall = domains.reduce(
    (sum, d) => sum + d.score * (d.entity_count / totalEntities),
    0
  );

  // Weighted average of individual factors across domains
  const overallFactors: FactorScores = {
    gap_resolution: 0,
    dependency_coverage: 0,
    decision_freshness: 0,
    ownership_distribution: 0,
  };

  for (const d of domains) {
    const w = d.entity_count / totalEntities;
    overallFactors.gap_resolution += d.factors.gap_resolution * w;
    overallFactors.dependency_coverage += d.factors.dependency_coverage * w;
    overallFactors.decision_freshness += d.factors.decision_freshness * w;
    overallFactors.ownership_distribution += d.factors.ownership_distribution * w;
  }

  overallFactors.gap_resolution = Math.round(overallFactors.gap_resolution);
  overallFactors.dependency_coverage = Math.round(overallFactors.dependency_coverage);
  overallFactors.decision_freshness = Math.round(overallFactors.decision_freshness);
  overallFactors.ownership_distribution = Math.round(overallFactors.ownership_distribution);

  return {
    overall_score: Math.round(weightedOverall),
    domains,
    factors: overallFactors,
  };
}
