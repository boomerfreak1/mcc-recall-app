/**
 * Test script: parse real documents from the repo, chunk them, and log results.
 *
 * Usage: npx tsx scripts/test-parsers.ts
 */

import fs from "fs";
import path from "path";
import { parseDocument, isSupported } from "../lib/parsers";
import { chunkDocument } from "../lib/indexing/chunker";

const REPO_ROOT = path.resolve(__dirname, "..");

// Test files — pick a workflow doc and an interview transcript
const TEST_FILES = [
  "workflows/workflows-MCC_T+O_Analysis_Cards.docx",
  "Interview Transcipts/Interview Transcript - C-suite experience & ABM.docx",
];

function divider(label: string) {
  console.log("\n" + "=".repeat(80));
  console.log(`  ${label}`);
  console.log("=".repeat(80));
}

function truncate(text: string, max = 200): string {
  if (text.length <= max) return text;
  return text.substring(0, max) + "...";
}

async function testFile(relativePath: string) {
  const fullPath = path.join(REPO_ROOT, relativePath);

  divider(`FILE: ${relativePath}`);

  if (!fs.existsSync(fullPath)) {
    console.log("  ⚠ File not found, skipping");
    return;
  }

  if (!isSupported(relativePath)) {
    console.log("  ⚠ Unsupported format, skipping");
    return;
  }

  const buffer = fs.readFileSync(fullPath);
  console.log(`  Size: ${(buffer.length / 1024).toFixed(1)} KB`);

  // Parse
  console.log("\n--- PARSING ---");
  const startParse = Date.now();
  const doc = await parseDocument(buffer, relativePath);
  const parseTime = Date.now() - startParse;

  console.log(`  Format: ${doc.format}`);
  console.log(`  Title: ${doc.title}`);
  console.log(`  Sections found: ${doc.sections.length}`);
  console.log(`  Raw text length: ${doc.rawText.length} chars`);
  console.log(`  Parse time: ${parseTime}ms`);
  console.log(`  Metadata:`, JSON.stringify(doc.metadata, null, 2));

  // Show sections
  console.log("\n--- SECTIONS ---");
  for (const section of doc.sections) {
    const contentPreview = truncate(section.content.replace(/\n/g, " "), 120);
    console.log(
      `  [L${section.level}] "${section.title}" (${section.content.length} chars)`
    );
    console.log(`       ${contentPreview}`);
  }

  // Chunk
  console.log("\n--- CHUNKING ---");
  const startChunk = Date.now();
  const chunks = chunkDocument(doc, { maxTokens: 512, minTokens: 50 });
  const chunkTime = Date.now() - startChunk;

  console.log(`  Chunks produced: ${chunks.length}`);
  console.log(`  Chunk time: ${chunkTime}ms`);
  console.log(
    `  Token range: ${Math.min(...chunks.map((c) => c.tokenEstimate))}-${Math.max(...chunks.map((c) => c.tokenEstimate))} tokens`
  );
  console.log(
    `  Avg tokens: ${Math.round(chunks.reduce((s, c) => s + c.tokenEstimate, 0) / chunks.length)}`
  );

  // Show first 5 chunks
  console.log("\n--- CHUNK SAMPLES (first 5) ---");
  for (const chunk of chunks.slice(0, 5)) {
    console.log(
      `  [${chunk.chunkIndex}] path: "${chunk.sectionPath}" (~${chunk.tokenEstimate} tokens)`
    );
    console.log(`       ${truncate(chunk.content.replace(/\n/g, " "), 150)}`);
    console.log();
  }

  if (chunks.length > 5) {
    console.log(`  ... and ${chunks.length - 5} more chunks`);
  }
}

async function main() {
  console.log("Recall Parser + Chunker Test");
  console.log(`Repo root: ${REPO_ROOT}`);
  console.log(`Test files: ${TEST_FILES.length}`);

  // Also scan for any xlsx files in the repo
  const allFiles = walkDir(REPO_ROOT);
  const xlsxFiles = allFiles.filter(
    (f) => f.endsWith(".xlsx") || f.endsWith(".xls")
  );
  if (xlsxFiles.length > 0) {
    console.log(`\nFound ${xlsxFiles.length} Excel file(s) in repo:`);
    for (const f of xlsxFiles) {
      console.log(`  ${path.relative(REPO_ROOT, f)}`);
      TEST_FILES.push(path.relative(REPO_ROOT, f));
    }
  } else {
    console.log("\nNo .xlsx files found in repo (Excel parser ready but no test data)");
  }

  for (const file of TEST_FILES) {
    await testFile(file);
  }

  divider("SUMMARY");
  console.log("  All parsers executed successfully.");
  console.log(
    "  Supported formats: .docx, .xlsx, .xls, .csv, .md, .pdf"
  );
}

function walkDir(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git") {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
