/**
 * Import gaps from the Excel tracker into SQLite.
 * Reads "All Gaps by Domain & Workflow" sheet by header name matching.
 * Full-replace on each import: clearGaps() → insertGaps().
 */

import * as XLSX from "xlsx";
import path from "path";
import fs from "fs";
import { clearGaps, insertGaps } from "../storage";

const DEFAULT_DATA_DIR = process.env.NODE_ENV === "production" ? "/data" : "./data";

function getExcelPath(): string {
  const dataDir = process.env.DATA_DIR ?? DEFAULT_DATA_DIR;
  return path.join(dataDir, "gaps", "Workflows-All-Domains.xlsx");
}

export async function importGapsFromExcel(): Promise<{ imported: number; domains: string[] }> {
  const excelPath = getExcelPath();

  if (!fs.existsSync(excelPath)) {
    throw new Error(`Excel file not found: ${excelPath}`);
  }

  const workbook = XLSX.readFile(excelPath);

  // Find the sheet with gap data
  const sheetName = workbook.SheetNames.find((name) =>
    name.toLowerCase().includes("all gaps")
  );

  if (!sheetName) {
    throw new Error(
      `Sheet "All Gaps by Domain & Workflow" not found. Available sheets: ${workbook.SheetNames.join(", ")}`
    );
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

  if (rows.length === 0) {
    throw new Error("No data rows found in the gaps sheet");
  }

  // Map headers flexibly by matching keywords
  const sampleRow = rows[0];
  const headers = Object.keys(sampleRow);

  function findHeader(keywords: string[]): string | null {
    return (
      headers.find((h) => {
        const lower = h.toLowerCase();
        return keywords.some((kw) => lower.includes(kw));
      }) ?? null
    );
  }

  const domainCol = findHeader(["domain"]);
  const workflowCol = findHeader(["workflow"]);
  const descriptionCol = findHeader(["gap description", "description"]);
  const typeCol = findHeader(["gap type", "type"]);
  const nextStepCol = findHeader(["recommended", "next step"]);

  if (!domainCol || !descriptionCol) {
    throw new Error(
      `Could not find required columns. Found: ${headers.join(", ")}. Need at least Domain and Gap Description.`
    );
  }

  // Parse rows into gap records
  const gaps: Array<{
    domain: string;
    workflow_name: string;
    gap_description: string;
    gap_type: string;
    recommended_next_step: string;
  }> = [];

  const domainSet = new Set<string>();

  for (const row of rows) {
    const domain = String(row[domainCol] ?? "").trim();
    const description = String(row[descriptionCol] ?? "").trim();

    if (!domain || !description) continue;

    const workflow = workflowCol ? String(row[workflowCol] ?? "").trim() : "";
    const gapType = typeCol ? String(row[typeCol] ?? "").trim() : "";
    const nextStep = nextStepCol ? String(row[nextStepCol] ?? "").trim() : "";

    domainSet.add(domain);
    gaps.push({
      domain,
      workflow_name: workflow,
      gap_description: description,
      gap_type: gapType,
      recommended_next_step: nextStep,
    });
  }

  // Full replace
  clearGaps();
  insertGaps(gaps);

  console.log(`[gaps] Imported ${gaps.length} gaps from ${domainSet.size} domains`);

  return {
    imported: gaps.length,
    domains: Array.from(domainSet).sort(),
  };
}
