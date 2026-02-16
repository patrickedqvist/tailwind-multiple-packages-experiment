# Remedy B: PostCSS Deduplication Plugin — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a PostCSS plugin that strips exact duplicate CSS rules, keeping the baseline per-package Tailwind build architecture intact.

**Architecture:** A new `packages/postcss-dedup/` package exports a PostCSS plugin. The plugin walks the CSS AST, builds a context-aware hash for each rule (layer + wrapping at-rules + selector + sorted declarations), and removes duplicates. Only the app (`apps/web/`) adds this plugin to its PostCSS config.

**Tech Stack:** PostCSS plugin API (ESM), Node.js built-in `crypto` for hashing, `node:test` for tests.

---

### Task 1: Create the `postcss-dedup` package scaffold

**Files:**
- Create: `packages/postcss-dedup/package.json`

**Step 1: Create `packages/postcss-dedup/package.json`**

```json
{
  "name": "@repo/postcss-dedup",
  "version": "0.0.0",
  "type": "module",
  "private": true,
  "exports": {
    ".": "./index.mjs"
  },
  "scripts": {
    "test": "node --test index.test.mjs"
  },
  "peerDependencies": {
    "postcss": "^8"
  },
  "devDependencies": {
    "postcss": "^8.5.3"
  }
}
```

**Step 2: Install dependencies**

Run: `cd /Users/pad/repos/experiments/tailwind-multiple-packages && pnpm install`
Expected: Lockfile updated, no errors.

**Step 3: Commit**

```bash
git add packages/postcss-dedup/package.json pnpm-lock.yaml
git commit -m "feat(postcss-dedup): scaffold package"
```

---

### Task 2: Write failing tests for the dedup plugin

**Files:**
- Create: `packages/postcss-dedup/index.test.mjs`

**Step 1: Write the tests**

These tests cover the core dedup scenarios. They import the plugin (which doesn't exist yet) and use `postcss.process()` to run it.

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
    // Both have the same declarations (just different order), so the second is a duplicate.
    // First occurrence wins, so the output keeps the first ordering.
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
    // Should result in a single @layer base block with the rule
    assert.ok(norm(output).includes("@layer base"));
    // Should NOT have two .a rules
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
    // After dedup the second @layer base block should be empty and removed.
    // Count how many @layer base blocks remain
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
```

**Step 2: Run the tests to verify they fail**

Run: `cd /Users/pad/repos/experiments/tailwind-multiple-packages/packages/postcss-dedup && node --test index.test.mjs`
Expected: All tests FAIL (cannot find module `./index.mjs`).

**Step 3: Commit**

```bash
git add packages/postcss-dedup/index.test.mjs
git commit -m "test(postcss-dedup): add failing tests for dedup plugin"
```

---

### Task 3: Implement the PostCSS dedup plugin

**Files:**
- Create: `packages/postcss-dedup/index.mjs`

**Step 1: Implement the plugin**

The plugin uses PostCSS's `Once` listener to walk the entire AST after all prior plugins have run. For each `Rule` node, it builds a context key from:
- The chain of parent at-rules (layer, media, supports, etc.)
- The selector
- Sorted declarations (property: value pairs)

For `AtRule` nodes that are "standalone" (like `@property`, `@font-face`), it builds a key from:
- The parent at-rule chain
- The at-rule name + params
- Sorted declarations inside

It hashes each key and tracks seen hashes. Duplicates are removed. Empty at-rule containers are cleaned up afterward.

```js
import { createHash } from "node:crypto";

/**
 * Build the at-rule context chain for a node.
 * Walks up the AST and collects parent at-rule names + params.
 * Returns a string like "layer:base|media:(min-width: 768px)"
 */
function getAtRuleContext(node) {
  const parts = [];
  let current = node.parent;
  while (current && current.type !== "root") {
    if (current.type === "atrule") {
      parts.unshift(`${current.name}:${current.params}`);
    }
    current = current.parent;
  }
  return parts.join("|");
}

/**
 * Serialize declarations of a rule/at-rule node into a deterministic string.
 * Sorts by property name so { color: red; margin: 0 } === { margin: 0; color: red }.
 */
function serializeDeclarations(node) {
  const decls = [];
  node.walkDecls((decl) => {
    decls.push(`${decl.prop}:${decl.value}${decl.important ? "!important" : ""}`);
  });
  decls.sort();
  return decls.join(";");
}

/**
 * Hash a string using SHA-256, return hex digest.
 */
function hash(str) {
  return createHash("sha256").update(str).digest("hex");
}

/**
 * Remove empty at-rule containers recursively.
 * After removing duplicate rules, an @layer or @media block may be left empty.
 */
function removeEmptyAtRules(root) {
  let changed = true;
  while (changed) {
    changed = false;
    root.walkAtRules((atRule) => {
      // An at-rule is "empty" if it has no child nodes
      // (but only for container at-rules, not things like @import or @charset)
      if (
        atRule.nodes !== undefined &&
        atRule.nodes.length === 0
      ) {
        atRule.remove();
        changed = true;
      }
    });
  }
}

const plugin = () => {
  return {
    postcssPlugin: "postcss-dedup",
    Once(root) {
      const seen = new Set();

      root.walk((node) => {
        let key;

        if (node.type === "rule") {
          const context = getAtRuleContext(node);
          const selector = node.selector;
          const decls = serializeDeclarations(node);
          key = `rule|${context}|${selector}|${decls}`;
        } else if (
          node.type === "atrule" &&
          // Standalone at-rules that contain declarations (like @property, @font-face)
          node.nodes !== undefined &&
          node.nodes.length > 0 &&
          node.nodes.every((child) => child.type === "decl")
        ) {
          const context = getAtRuleContext(node);
          const decls = serializeDeclarations(node);
          key = `atrule|${context}|${node.name}:${node.params}|${decls}`;
        } else {
          // Not a deduplicate-able node (container at-rule, comment, etc.)
          return;
        }

        const h = hash(key);
        if (seen.has(h)) {
          node.remove();
        } else {
          seen.add(h);
        }
      });

      // Clean up empty containers left behind
      removeEmptyAtRules(root);
    },
  };
};

plugin.postcss = true;

export default plugin;
```

**Step 2: Run the tests**

Run: `cd /Users/pad/repos/experiments/tailwind-multiple-packages/packages/postcss-dedup && node --test index.test.mjs`
Expected: All tests PASS.

**Step 3: If any tests fail, debug and fix**

Read the failure output carefully. Common issues:
- PostCSS's `walk()` can visit child nodes of removed parents — may need to skip already-removed nodes
- `@layer` blocks with `@property` inside them may need special handling
- Whitespace normalization in assertions

**Step 4: Commit**

```bash
git add packages/postcss-dedup/index.mjs
git commit -m "feat(postcss-dedup): implement context-aware CSS dedup plugin"
```

---

### Task 4: Restore baseline CSS architecture (undo Remedy A changes)

The current workspace has Remedy A changes. Remedy B needs the baseline architecture where each feature package has its own CSS build. We need to restore:
- Feature package `build:styles` / `dev:styles` scripts
- Feature package `styles.css` source files
- Feature package `exports` with `./styles.css` entry
- UI package `build:styles` / `dev:styles` scripts and exports
- App `layout.tsx` CSS imports (`@repo/ui/styles.css` etc.)
- App `globals.css` without `@source` directives

**Files:**
- Modify: `features/feature-a/package.json` — restore scripts, exports, files field
- Modify: `features/feature-b/package.json` — restore scripts, exports, files field
- Modify: `packages/ui/package.json` — restore scripts, exports, files field (check `main` branch)
- Create: `features/feature-a/src/styles.css` — restore from `main` branch
- Create: `features/feature-b/src/styles.css` — restore from `main` branch
- Modify: `apps/web/app/globals.css` — remove `@source` directives
- Modify: `apps/web/app/layout.tsx` — restore CSS imports from `main` branch
- Modify: `turbo.json` — may need `build:styles` task if it existed on `main`

**Step 1: Restore each file from main branch**

For each file, use `git show main:<path>` to get the baseline content and write it back. Key differences from current state:

**`features/feature-a/package.json`** — add back `files`, `exports["./styles.css"]`, `scripts.build:styles`, `scripts.dev:styles`

**`features/feature-a/src/styles.css`** — recreate with:
```css
/* Component-level styles for the feature-a package */
@import "tailwindcss";
@import "@repo/tailwind-config";
```

**`features/feature-b/src/styles.css`** — same pattern as feature-a.

**`features/feature-b/package.json`** — same restoration as feature-a.

**`apps/web/app/globals.css`** — remove the three `@source` directives. Keep the `@import` lines and `:root` / `body` styles.

**`apps/web/app/layout.tsx`** — restore the `import "@repo/ui/styles.css"` line.

**Step 2: Verify build still works without the dedup plugin first**

Run: `cd /Users/pad/repos/experiments/tailwind-multiple-packages && pnpm build`
Expected: Build succeeds. This is the baseline architecture with CSS duplication.

**Step 3: Run analyze-css to confirm baseline duplication numbers**

Run: `pnpm analyze-css`
Expected: ~69% overall duplication (matching FINDINGS.md baseline).

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor: restore baseline CSS architecture for Remedy B"
```

---

### Task 5: Wire the dedup plugin into the web app's PostCSS config

**Files:**
- Modify: `apps/web/package.json` — add `@repo/postcss-dedup` as dev dependency
- Modify: `apps/web/postcss.config.js` — add the dedup plugin after Tailwind

**Step 1: Add the dependency**

Add `"@repo/postcss-dedup": "workspace:*"` to `apps/web/package.json` devDependencies.

**Step 2: Update `apps/web/postcss.config.js`**

The current config uses the `plugins` object format from the shared config. The dedup plugin needs to be added after Tailwind processes. The new config:

```js
import { postcssConfig } from "@repo/tailwind-config/postcss";
import dedup from "@repo/postcss-dedup";

export default {
  plugins: {
    ...postcssConfig.plugins,
    "@repo/postcss-dedup": {},
  },
};
```

Note: PostCSS configs in Next.js use the object syntax where keys are plugin names or paths. Since our plugin is a default export, we may need to use the array syntax or configure it differently. If the object syntax doesn't work, switch to:

```js
import { postcssConfig } from "@repo/tailwind-config/postcss";
import dedup from "@repo/postcss-dedup";

export default {
  plugins: [
    ...Object.entries(postcssConfig.plugins).map(([name, opts]) => [name, opts]),
    dedup,
  ],
};
```

Test both approaches — Next.js PostCSS config can be finicky. The key requirement is that `@tailwindcss/postcss` runs first, then `postcss-dedup` runs on the output.

**Step 3: Run pnpm install**

Run: `pnpm install`

**Step 4: Commit**

```bash
git add apps/web/package.json apps/web/postcss.config.js pnpm-lock.yaml
git commit -m "feat(web): wire postcss-dedup plugin into app PostCSS config"
```

---

### Task 6: Build and measure results

**Step 1: Run the full build**

Run: `cd /Users/pad/repos/experiments/tailwind-multiple-packages && pnpm build`
Expected: Build succeeds without errors.

**Step 2: Run CSS analysis**

Run: `pnpm analyze-css`
Expected: Duplication should drop significantly from the 69.4% baseline. Record the exact numbers.

**Step 3: Compare results**

| Metric | Baseline | Remedy A | Remedy B |
|--------|----------|----------|----------|
| CSS size | 41.4 KB | 19.5 KB | ? |
| Overall duplication | 69.4% | 31.2% | ? |

**Step 4: If results are unexpected, debug**

- If duplication hasn't changed: verify the plugin is actually running (add a `console.log` in `Once` and check build output)
- If the build fails: check the PostCSS config wiring (Task 5 notes)
- If CSS is broken: compare specific rules that were removed vs kept

**Step 5: Commit**

No code changes needed here, but if any fixes were made during debugging, commit them.

---

### Task 7: Update REMEDIES.md with Remedy B results

**Files:**
- Modify: `REMEDIES.md`

**Step 1: Add Remedy B section**

Add a new section to REMEDIES.md documenting Remedy B alongside Remedy A. Include:
- Approach description
- Changes made (new package, PostCSS config update)
- Measured results table
- Trade-offs comparison with Remedy A
- The actual numbers from Task 6

**Step 2: Commit**

```bash
git add REMEDIES.md
git commit -m "docs: add Remedy B results to REMEDIES.md"
```

---

### Task 8: Final review

**Step 1: Run the dev server and visually verify**

Run: `pnpm dev`
Open: `http://localhost:3001`
Expected: The app looks identical to baseline — badges, banners, cards, gradients all render correctly.

**Step 2: Run the test suite one more time**

Run: `cd packages/postcss-dedup && node --test index.test.mjs`
Expected: All tests pass.

**Step 3: Review all changes**

Run: `git diff main --stat`
Verify the changeset makes sense: new package, restored baseline files, updated PostCSS config, updated docs.
