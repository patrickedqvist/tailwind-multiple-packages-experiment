# Proposed Remedies for CSS Duplication

This document accompanies [FINDINGS.md](./FINDINGS.md). It catalogues remediation strategies, each with a description of the approach, measured impact, and trade-offs.

## Baseline

From the findings, the current architecture produces:

| Metric | Value |
|---|---|
| Combined CSS size | 41.4 KB |
| Duplicated selectors | 64.2% |
| Duplicated declarations | 68.4% |
| Duplicated at-rules | 96.6% |
| Overall structural duplication | 69.4% |

All remedies are measured against this baseline.

---

## Remedy A: Single Tailwind Build at the App Level

### Approach

Remove all CSS compilation from feature packages. The Next.js app becomes the sole Tailwind compilation unit. Packages export only source components (`.tsx` files); the app's `globals.css` imports Tailwind once and uses `@source` directives to tell Tailwind where to scan for utility classes across all packages.

```css
/* apps/web/app/globals.css */
@import "tailwindcss";
@import "@repo/tailwind-config";

@source "../../../packages/ui/src";
@source "../../../features/feature-a/src";
@source "../../../features/feature-b/src";
```

Package `build:styles` scripts, `#styles` import aliases, and `dist/*.css` outputs are removed entirely. Feature teams write Tailwind classes in their components and nothing else.

### Why This Remedy

A key constraint is that the feature teams developing in this monorepo do not have deep CSS expertise. The chosen remedy must minimise the CSS-related decisions and configuration that feature developers are exposed to.

Remedy A achieves this because:

- **Feature teams don't touch CSS infrastructure.** They write Tailwind utility classes in JSX and it works. There is no `build:styles` script to run, no `#styles` import to remember, no `src/styles.css` to maintain.
  - With one caveat that their feature package must be added to the app's `globals.css` with an `@source` directive. This is a one-time setup step per package.
- **There is one way to do things.** A single Tailwind build at the app level eliminates questions about partial imports, layer ordering, or which CSS file to import.
- **Errors are caught early.** If a class name is misspelled, Tailwind simply doesn't generate it — there is no stale pre-compiled CSS to mask the problem.

### Measured Impact

| Metric | Baseline | Remedy A | Change |
|---|---|---|---|
| Combined CSS size | 41.4 KB | 19.5 KB | **-52.9%** |
| Selectors (total) | 564 | 223 | -60.5% |
| Duplicated selectors | 64.2% | 10.3% | -53.9 pp |
| Duplicated declarations | 68.4% | 31.7% | -36.7 pp |
| Duplicated at-rules | 96.6% | 93.1% | -3.5 pp |
| Overall structural duplication | 69.4% | 31.2% | -38.2 pp |

### Trade-offs

- Packages cannot ship pre-compiled CSS. They depend on the consuming app to compile their styles.
- If packages are consumed by multiple apps, each app must configure its own `@source` directives pointing to the package source directories.
- CSS for package components is only compiled when running the app's dev server or build. Packages cannot be styled in complete isolation.
- The `@source` paths in `globals.css` must be maintained as new packages are added to the monorepo.

### Implementation

Branch: `remedy-a`

---

## Remedy B: Post-Build CSS Deduplication

### Approach

Keep the existing per-package CSS build architecture — each feature package independently compiles its own Tailwind CSS bundle. After `next build` completes, a post-build step processes the final CSS chunks in `.next/static/chunks/`, removing exact duplicate rules within each chunk.

The deduplication logic lives in a shared package (`@repo/postcss-dedup`) that exports both a PostCSS plugin and a CLI tool. Apps add a single `postcss-dedup` step to their build script:

```json
{
  "build": "next build && postcss-dedup .next/static/chunks && cp -r public ..."
}
```

Deduplication operates in two passes:

**Pass 1 — Whole-rule dedup.** A CSS rule is considered a duplicate only when **all** of the following match a previously seen rule:

1. **Layer context** — which `@layer` it's inside (or none)
2. **Wrapping at-rules** — any `@media`, `@supports`, etc.
3. **Selector** — the full selector string
4. **Declarations** — all property-value pairs (sorted by property for deterministic comparison)

**Pass 2 — Declaration-level dedup.** Rules that share the same selector and at-rule context but have *different* declaration sets are not fully duplicated — but they may share individual declarations. The second pass groups rules by (context, selector) and strips duplicate declarations from later rules. If a rule becomes empty after stripping, it is removed entirely.

First occurrence always wins in both passes. Empty at-rule containers are cleaned up after removal.

### Why This Remedy

- **No architecture changes.** Feature packages keep their independent CSS builds, `build:styles` scripts, and `dist/*.css` exports. Nothing about the development workflow changes.
- **Drop-in addition.** A single line added to the app's build script. No PostCSS config changes, no `@source` directives to maintain.
- **Correctness by design.** Only exact duplicates are removed. Layer boundaries, media query context, and cascade order are all preserved. The post-build approach means it operates on the final CSS output — after Next.js has made all its chunking decisions.
- **Per-chunk safety.** Each CSS chunk is deduplicated independently. No cross-chunk assumptions, so route-based code splitting is respected.

### Why Post-Build Instead of PostCSS Plugin

An earlier iteration wired the dedup logic as a PostCSS plugin in the app's `postcss.config.js`. This approach proved ineffective because **Next.js runs PostCSS per-file** before concatenating CSS imports into chunks. The plugin only saw one file's CSS at a time and could not detect cross-file duplicates.

Running after `next build` means we operate on the final concatenated CSS output — exactly what ships to the browser.

### Measured Impact

Next.js produced 2 CSS chunks in the experiment. Each chunk was deduplicated independently.

**Per-chunk results:**

| Chunk | Before | After | Saved |
|---|---|---|---|
| Chunk 1 (app styles) | 12.7 KB | 12.4 KB | 0.3 KB (2.6%) |
| Chunk 2 (component styles) | 28.7 KB | 13.8 KB | 14.9 KB (51.8%) |
| **Total** | **41.4 KB** | **26.2 KB** | **15.2 KB (36.7%)** |

Chunk 1 contains mostly unique CSS with minimal duplication. Chunk 2 — which aggregates the per-package Tailwind builds from the UI package and feature packages — carries the bulk of the duplicated preflight, theme, and property declarations. The dedup pass removes over half of that chunk.

### What Remains After Dedup

The remaining duplication falls into two categories:

1. **Cross-chunk duplication (intentional).** Both chunks carry their own copy of Tailwind boilerplate (`@layer base`, `@layer theme`). This is by design — each chunk must work independently for route-based code splitting.
2. **Common declaration values across different selectors.** Properties like `display: flex` or `font-weight: inherit` appear in multiple unrelated rules. These are not duplicates — they're independent rules that happen to share a value.

The declaration-level dedup pass handles the case where same-selector rules in the same context share some but not all declarations (e.g. `@layer properties` blocks with overlapping custom property fallbacks). Shared declarations are stripped from later rules, keeping only the unique properties in each.

### Trade-offs

- Post-build step adds processing time
- Deduplication is conservative — only exact matches are removed. Near-duplicates (e.g. slightly different values) are kept.
- Each app must add the `postcss-dedup` step to its build script.
- Does not deduplicate across CSS chunks — if Next.js produces multiple CSS files (e.g. per-route splitting), each is deduplicated independently. Rules shared across chunks are kept in both.

### Implementation

Branch: `remedy-b`
