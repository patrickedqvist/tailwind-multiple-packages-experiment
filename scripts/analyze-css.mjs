import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { analyze } from "@projectwallace/css-analyzer";

const chunksDir = join(import.meta.dirname, "../apps/web/.next/static/chunks");
const jsonMode = process.argv.includes("--json");

// Find all CSS files in the chunks directory
let cssFiles;
try {
  cssFiles = readdirSync(chunksDir).filter((f) => f.endsWith(".css"));
} catch {
  console.error(
    "No CSS chunks found. Run `pnpm build` first to generate the build output.",
  );
  process.exit(1);
}

if (cssFiles.length === 0) {
  console.error("No .css files found in", chunksDir);
  process.exit(1);
}

// Concatenate all CSS files into one string
const combinedCss = cssFiles
  .map((f) => readFileSync(join(chunksDir, f), "utf-8"))
  .join("\n");

const totalBytes = Buffer.byteLength(combinedCss, "utf-8");

console.log(`Found ${cssFiles.length} CSS file(s):`);
for (const f of cssFiles) {
  const size = readFileSync(join(chunksDir, f)).byteLength;
  console.log(`  ${f} (${(size / 1024).toFixed(1)} KB)`);
}
console.log(`Combined size: ${(totalBytes / 1024).toFixed(1)} KB`);
console.log("");

const result = analyze(combinedCss);

if (jsonMode) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

// Print a human-readable summary
console.log("=".repeat(60));
console.log("CSS ANALYSIS REPORT");
console.log("=".repeat(60));

// Stylesheet
console.log("\nStylesheet");
console.log("-".repeat(40));
console.log(`  Size:               ${result.stylesheet.size.toLocaleString()} bytes`);
console.log(`  Lines of code:      ${result.stylesheet.linesOfCode}`);
console.log(`  Source lines:       ${result.stylesheet.sourceLinesOfCode}`);
console.log(`  Comments:           ${result.stylesheet.comments.total}`);

// Rules
console.log("\nRules");
console.log("-".repeat(40));
console.log(`  Total:              ${result.rules.total}`);
console.log(`  Empty:              ${result.rules.empty.total} (${(result.rules.empty.ratio * 100).toFixed(1)}%)`);

// Selectors
console.log("\nSelectors");
console.log("-".repeat(40));
console.log(`  Total:              ${result.selectors.total}`);
console.log(`  Unique:             ${result.selectors.totalUnique}`);
console.log(`  Uniqueness ratio:   ${(result.selectors.uniquenessRatio * 100).toFixed(1)}%`);
if (result.selectors.id.total > 0) {
  console.log(`  ID selectors:       ${result.selectors.id.total}`);
}
console.log(`  Specificity (max):  [${result.selectors.specificity.max.join(",")}]`);
console.log(`  Specificity (mean): [${result.selectors.specificity.mean.map((n) => n.toFixed(1)).join(",")}]`);
console.log(`  Complexity (max):   ${result.selectors.complexity.max}`);
console.log(`  Complexity (mean):  ${result.selectors.complexity.mean.toFixed(1)}`);

// Declarations
console.log("\nDeclarations");
console.log("-".repeat(40));
console.log(`  Total:              ${result.declarations.total}`);
console.log(`  Unique:             ${result.declarations.totalUnique} (${(result.declarations.uniquenessRatio * 100).toFixed(1)}%)`);
console.log(`  !important:         ${result.declarations.importants.total} (${(result.declarations.importants.ratio * 100).toFixed(1)}%)`);

// Duplication summary
console.log("\nDuplication");
console.log("-".repeat(40));
const duplicationRows = [
  ["Selectors", result.selectors.total, result.selectors.totalUnique],
  ["Declarations", result.declarations.total, result.declarations.totalUnique],
  ["At-rules", result.atrules.total, result.atrules.totalUnique],
];
const nameWidth = 16;
console.log(
  `  ${"".padEnd(nameWidth)}${"Total".padStart(7)}${"Unique".padStart(8)}${"Dupl.".padStart(8)}${"Ratio".padStart(8)}`,
);
let sumTotal = 0;
let sumUnique = 0;
for (const [name, total, unique] of duplicationRows) {
  if (total === 0) continue;
  sumTotal += total;
  sumUnique += unique;
  const duplicated = total - unique;
  const ratio = (duplicated / total) * 100;
  console.log(
    `  ${name.padEnd(nameWidth)}${String(total).padStart(7)}${String(unique).padStart(8)}${String(duplicated).padStart(8)}${(ratio.toFixed(1) + "%").padStart(8)}`,
  );
}
const sumDuplicated = sumTotal - sumUnique;
const sumRatio = sumTotal > 0 ? (sumDuplicated / sumTotal) * 100 : 0;
console.log(`  ${"".padEnd(nameWidth)}${"-------".padStart(7)}${"--------".padStart(8)}${"--------".padStart(8)}${"--------".padStart(8)}`);
console.log(
  `  ${"Total".padEnd(nameWidth)}${String(sumTotal).padStart(7)}${String(sumUnique).padStart(8)}${String(sumDuplicated).padStart(8)}${(sumRatio.toFixed(1) + "%").padStart(8)}`,
);


console.log("\n" + "=".repeat(60));
