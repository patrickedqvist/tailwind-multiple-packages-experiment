#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dedup } from "./index.mjs";

const dir = process.argv[2];

if (!dir) {
  console.error("Usage: postcss-dedup <directory>");
  console.error("  Deduplicates CSS rules in all .css files in the given directory.");
  process.exit(1);
}

let cssFiles;
try {
  cssFiles = readdirSync(dir).filter((f) => f.endsWith(".css"));
} catch {
  console.error(`Could not read directory: ${dir}`);
  process.exit(1);
}

if (cssFiles.length === 0) {
  console.error(`No .css files found in ${dir}`);
  process.exit(1);
}

console.log(`Found ${cssFiles.length} CSS file(s) to deduplicate:\n`);

let totalBefore = 0;
let totalAfter = 0;

for (const file of cssFiles) {
  const filePath = join(dir, file);
  const original = readFileSync(filePath, "utf-8");
  const sizeBefore = Buffer.byteLength(original, "utf-8");

  const deduplicated = await dedup(original);
  const sizeAfter = Buffer.byteLength(deduplicated, "utf-8");

  writeFileSync(filePath, deduplicated, "utf-8");

  const reduction = sizeBefore - sizeAfter;
  const pct = sizeBefore > 0 ? ((reduction / sizeBefore) * 100).toFixed(1) : "0.0";

  console.log(`  ${file}`);
  console.log(`    Before: ${(sizeBefore / 1024).toFixed(1)} KB`);
  console.log(`    After:  ${(sizeAfter / 1024).toFixed(1)} KB`);
  console.log(`    Saved:  ${(reduction / 1024).toFixed(1)} KB (${pct}%)\n`);

  totalBefore += sizeBefore;
  totalAfter += sizeAfter;
}

const totalReduction = totalBefore - totalAfter;
const totalPct = totalBefore > 0 ? ((totalReduction / totalBefore) * 100).toFixed(1) : "0.0";

console.log(`Total:`);
console.log(`  Before: ${(totalBefore / 1024).toFixed(1)} KB`);
console.log(`  After:  ${(totalAfter / 1024).toFixed(1)} KB`);
console.log(`  Saved:  ${(totalReduction / 1024).toFixed(1)} KB (${totalPct}%)`);
