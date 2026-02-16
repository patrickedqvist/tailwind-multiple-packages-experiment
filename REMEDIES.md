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

@source "../../packages/ui/src";
@source "../../features/feature-a/src";
@source "../../features/feature-b/src";
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
| Combined CSS size | 41.4 KB | 12.7 KB | **-69.3%** |
| Selectors (total) | 564 | 172 | -69.5% |
| Duplicated selectors | 64.2% | 12.8% | -51.4 pp |
| Duplicated declarations | 68.4% | 32.1% | -36.3 pp |
| Duplicated at-rules | 96.6% | 90.4% | -6.2 pp |
| Overall structural duplication | 69.4% | 31.6% | -37.8 pp |

### Trade-offs

- Packages cannot ship pre-compiled CSS. They depend on the consuming app to compile their styles.
- If packages are consumed by multiple apps, each app must configure its own `@source` directives pointing to the package source directories.
- CSS for package components is only compiled when running the app's dev server or build. Packages cannot be styled in complete isolation.
- The `@source` paths in `globals.css` must be maintained as new packages are added to the monorepo.

### Implementation

Branch: `remedy-a`
