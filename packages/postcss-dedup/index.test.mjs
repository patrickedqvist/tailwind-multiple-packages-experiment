import assert from "node:assert/strict";
import { describe, it } from "node:test";
import postcss from "postcss";
import dedup from "./index.mjs";

/**
 * Helper: run CSS through the dedup plugin and return the output string.
 */
async function run(css) {
  const result = await postcss([dedup]).process(css, { from: undefined });
  return result.css;
}

/**
 * Helper: normalize whitespace for comparison.
 * Collapses runs of whitespace to a single space and trims.
 */
function norm(css) {
  return css.replace(/\s+/g, " ").trim();
}

describe("postcss-dedup", () => {
  it("removes exact duplicate rules", async () => {
    const input = `
      .a { color: red; }
      .a { color: red; }
    `;
    const output = await run(input);
    assert.equal(norm(output), norm(".a { color: red; }"));
  });

  it("keeps rules with different selectors", async () => {
    const input = `
      .a { color: red; }
      .b { color: red; }
    `;
    const output = await run(input);
    assert.equal(norm(output), norm(".a { color: red; } .b { color: red; }"));
  });

  it("keeps rules with different declarations", async () => {
    const input = `
      .a { color: red; }
      .a { color: blue; }
    `;
    const output = await run(input);
    assert.equal(norm(output), norm(".a { color: red; } .a { color: blue; }"));
  });

  it("normalizes declaration order for comparison", async () => {
    const input = `
      .a { margin: 0; color: red; }
      .a { color: red; margin: 0; }
    `;
    const output = await run(input);
    assert.equal(norm(output), norm(".a { margin: 0; color: red; }"));
  });

  it("deduplicates inside @layer blocks", async () => {
    const input = `
      @layer base {
        .a { color: red; }
      }
      @layer base {
        .a { color: red; }
      }
    `;
    const output = await run(input);
    assert.ok(norm(output).includes("@layer base"));
    const matches = output.match(/\.a\s*\{/g);
    assert.equal(matches?.length, 1);
  });

  it("does NOT deduplicate same rule across different layers", async () => {
    const input = `
      @layer base {
        .a { color: red; }
      }
      @layer utilities {
        .a { color: red; }
      }
    `;
    const output = await run(input);
    const matches = output.match(/\.a\s*\{/g);
    assert.equal(matches?.length, 2);
  });

  it("deduplicates inside @media blocks", async () => {
    const input = `
      @media (min-width: 768px) {
        .a { color: red; }
      }
      @media (min-width: 768px) {
        .a { color: red; }
      }
    `;
    const output = await run(input);
    const matches = output.match(/\.a\s*\{/g);
    assert.equal(matches?.length, 1);
  });

  it("does NOT deduplicate same rule in different @media contexts", async () => {
    const input = `
      @media (min-width: 768px) {
        .a { color: red; }
      }
      @media (min-width: 1024px) {
        .a { color: red; }
      }
    `;
    const output = await run(input);
    const matches = output.match(/\.a\s*\{/g);
    assert.equal(matches?.length, 2);
  });

  it("does NOT deduplicate rule inside @media vs rule outside", async () => {
    const input = `
      .a { color: red; }
      @media (min-width: 768px) {
        .a { color: red; }
      }
    `;
    const output = await run(input);
    const matches = output.match(/\.a\s*\{/g);
    assert.equal(matches?.length, 2);
  });

  it("handles nested at-rules: @layer > @media", async () => {
    const input = `
      @layer utilities {
        @media (min-width: 768px) {
          .a { color: red; }
        }
      }
      @layer utilities {
        @media (min-width: 768px) {
          .a { color: red; }
        }
      }
    `;
    const output = await run(input);
    const matches = output.match(/\.a\s*\{/g);
    assert.equal(matches?.length, 1);
  });

  it("removes empty at-rules after dedup", async () => {
    const input = `
      @layer base {
        .a { color: red; }
      }
      @layer base {
        .a { color: red; }
      }
    `;
    const output = await run(input);
    const layerMatches = output.match(/@layer\s+base/g);
    assert.equal(layerMatches?.length, 1);
  });

  it("deduplicates @property declarations", async () => {
    const input = `
      @property --my-color {
        syntax: "<color>";
        inherits: false;
        initial-value: red;
      }
      @property --my-color {
        syntax: "<color>";
        inherits: false;
        initial-value: red;
      }
    `;
    const output = await run(input);
    const matches = output.match(/@property\s+--my-color/g);
    assert.equal(matches?.length, 1);
  });

  it("deduplicates @font-face declarations", async () => {
    const input = `
      @font-face {
        font-family: "MyFont";
        src: url("myfont.woff2") format("woff2");
      }
      @font-face {
        font-family: "MyFont";
        src: url("myfont.woff2") format("woff2");
      }
    `;
    const output = await run(input);
    const matches = output.match(/@font-face/g);
    assert.equal(matches?.length, 1);
  });

  it("deduplicates inside @supports blocks", async () => {
    const input = `
      @supports (display: grid) {
        .a { color: red; }
      }
      @supports (display: grid) {
        .a { color: red; }
      }
    `;
    const output = await run(input);
    const matches = output.match(/\.a\s*\{/g);
    assert.equal(matches?.length, 1);
  });

  // Declaration-level dedup tests
  it("removes duplicate declarations from same-selector rules in same context", async () => {
    const input = `
      .a { color: red; margin: 0; }
      .a { color: red; padding: 10px; }
    `;
    const output = await run(input);
    // First rule keeps all its decls
    assert.ok(norm(output).includes("color: red"));
    assert.ok(norm(output).includes("margin: 0"));
    assert.ok(norm(output).includes("padding: 10px"));
    // color: red should appear only once
    const colorMatches = output.match(/color:\s*red/g);
    assert.equal(colorMatches?.length, 1);
  });

  it("removes duplicate declarations across same-selector rules inside @layer", async () => {
    const input = `
      @layer properties {
        @supports (display: grid) {
          *, :before, :after { --tw-border-style: solid; --tw-shadow: 0 0 #0000; }
        }
      }
      @layer properties {
        @supports (display: grid) {
          *, :before, :after { --tw-border-style: solid; --tw-blur: initial; }
        }
      }
    `;
    const output = await run(input);
    // --tw-border-style should appear only once
    const borderMatches = output.match(/--tw-border-style/g);
    assert.equal(borderMatches?.length, 1);
    // Both unique declarations should remain
    assert.ok(output.includes("--tw-shadow"));
    assert.ok(output.includes("--tw-blur"));
  });

  it("does NOT remove declarations across different selectors", async () => {
    const input = `
      .a { color: red; }
      .b { color: red; }
    `;
    const output = await run(input);
    const colorMatches = output.match(/color:\s*red/g);
    assert.equal(colorMatches?.length, 2);
  });

  it("does NOT remove declarations across different contexts", async () => {
    const input = `
      @layer base {
        .a { color: red; margin: 0; }
      }
      @layer utilities {
        .a { color: red; padding: 10px; }
      }
    `;
    const output = await run(input);
    const colorMatches = output.match(/color:\s*red/g);
    assert.equal(colorMatches?.length, 2);
  });

  it("removes rule entirely if all declarations are duplicates", async () => {
    const input = `
      .a { color: red; margin: 0; }
      .a { color: red; }
    `;
    const output = await run(input);
    // Second rule should be removed entirely (all its decls are dupes)
    const ruleMatches = output.match(/\.a\s*\{/g);
    assert.equal(ruleMatches?.length, 1);
  });

  it("preserves non-duplicated rules", async () => {
    const input = `
      .a { color: red; }
      .b { margin: 0; }
      .c { padding: 10px; }
    `;
    const output = await run(input);
    assert.equal(norm(output), norm(input));
  });
});
