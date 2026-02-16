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

A CSS rule is considered a duplicate only when **all** of the following match a previously seen rule:

1. **Layer context** — which `@layer` it's inside (or none)
2. **Wrapping at-rules** — any `@media`, `@supports`, etc.
3. **Selector** — the full selector string
4. **Declarations** — all property-value pairs (sorted by property for deterministic comparison)

First occurrence always wins. Empty at-rule containers are cleaned up after removal.

### Why This Remedy

- **No architecture changes.** Feature packages keep their independent CSS builds, `build:styles` scripts, and `dist/*.css` exports. Nothing about the development workflow changes.
- **Drop-in addition.** A single line added to the app's build script. No PostCSS config changes, no `@source` directives to maintain.
- **Correctness by design.** Only exact duplicates are removed. Layer boundaries, media query context, and cascade order are all preserved. The post-build approach means it operates on the final CSS output — after Next.js has made all its chunking decisions.
- **Per-chunk safety.** Each CSS chunk is deduplicated independently. No cross-chunk assumptions, so route-based code splitting is respected.

### Why Post-Build Instead of PostCSS Plugin

An earlier iteration wired the dedup logic as a PostCSS plugin in the app's `postcss.config.js`. This approach proved ineffective because **Next.js runs PostCSS per-file** before concatenating CSS imports into chunks. The plugin only saw one file's CSS at a time and could not detect cross-file duplicates.

Running after `next build` means we operate on the final concatenated CSS output — exactly what ships to the browser.

### Measured Impact

| Metric | Baseline | Remedy A | Remedy B | Remedy B Change |
|---|---|---|---|---|
| Combined CSS size | 35.2 KB | 19.5 KB | 18.7 KB | **-46.8%** |
| Duplicated selectors | 67.1% | 10.3% | 19.3% | -47.8 pp |
| Duplicated declarations | 67.7% | 31.7% | 38.4% | -29.3 pp |
| Duplicated at-rules | 95.6% | 93.1% | 93.5% | -2.1 pp |
| Overall structural duplication | 69.5% | 31.2% | 38.7% | **-30.8 pp** |

Remedy B achieves the smallest CSS file size (18.7 KB) while maintaining higher structural duplication metrics than Remedy A. The remaining duplication is largely from at-rules (`@layer` wrappers) that are structurally similar but contain different content.

### Trade-offs

- Post-build step adds processing time (negligible for small projects, may matter at scale).
- Deduplication is conservative — only exact matches are removed. Near-duplicates (e.g. slightly different values) are kept.
- Each app must add the `postcss-dedup` step to its build script.
- Does not deduplicate across CSS chunks — if Next.js produces multiple CSS files (e.g. per-route splitting), each is deduplicated independently. Rules shared across chunks are kept in both.

### Implementation

Branch: `remedy-b`
