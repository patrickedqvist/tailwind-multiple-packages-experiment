# Tailwind CSS Multi-Package Monorepo Experiment

This repo explores how Tailwind CSS v4 behaves in a Turborepo monorepo where **multiple packages each build their own CSS independently**. The goal is to understand the CSS duplication that occurs when each package runs its own Tailwind build and the final output is bundled together by a Next.js app.

## Structure

```
apps/
  web/              → Next.js 16 app (output: standalone)
packages/
  ui/               → Shared component library (Card, Gradient, TurborepoLogo)
  tailwind-config/  → Shared Tailwind theme and PostCSS config
  typescript-config/ → Shared TypeScript configs
features/
  feature-a/        → Feature package (Badge, Banner components)
  feature-b/        → Feature package (Badge, Banner components)
```

### `@repo/tailwind-config`

Central package that exports:
- `shared-styles.css` — imports `tailwindcss` and defines custom theme tokens (`blue-1000`, `purple-1000`, `red-1000`)
- `postcss.config.js` — shared PostCSS config with `@tailwindcss/postcss`

### `@repo/ui`

Component library. Has its own `src/styles.css` that imports Tailwind + the shared config. Builds CSS independently via `@tailwindcss/cli` to `dist/`. Components import the compiled CSS using the `#styles` import alias.

### `features/feature-a` and `features/feature-b`

Feature packages following the same pattern as `@repo/ui` — each has its own Tailwind build that produces a separate CSS bundle in `dist/`.

### `apps/web`

Next.js app that consumes all packages. Has its own `globals.css` that also imports Tailwind + the shared config, processed via PostCSS. Uses `output: "standalone"` for production deployment.

## The Problem

Each package (`ui`, `feature-a`, `feature-b`) and the web app all run independent Tailwind builds. Every build emits the full Tailwind boilerplate:

- `@layer base` (preflight/reset) — ~16.5 KB each
- `@layer theme` (CSS custom properties) — ~3 KB each
- `@layer properties` (`@property` declarations) — ~3.4 KB each

When Next.js bundles everything into a single CSS file, this boilerplate is duplicated 3x. In the built output:

| | Size |
|---|---|
| Total CSS file | ~80 KB |
| Duplicated boilerplate | ~46 KB (56%) |
| Unique utility classes | ~12.5 KB |
| If deduplicated | ~35 KB |

## CSS Analysis

After building (`pnpm build`), you can run `pnpm analyze-css` to get a detailed report on the combined CSS output using [`@projectwallace/css-analyzer`](https://github.com/projectwallace/css-analyzer). Use `pnpm analyze-css --json` for the full raw data.

Current results:

```
Found 2 CSS file(s):
  c38a0d10d4e64d54.css (12.7 KB)
  df206b99cb7c0b33.css (28.7 KB)
Combined size: 41.4 KB

============================================================
CSS ANALYSIS REPORT
============================================================

Stylesheet
----------------------------------------
  Size:               42,435 bytes
  Lines of code:      7
  Source lines:       1797
  Comments:           0

Rules
----------------------------------------
  Total:              423
  Empty:              0 (0.0%)

Selectors
----------------------------------------
  Total:              559
  Unique:             200
  Uniqueness ratio:   35.8%
  Specificity (max):  [0,2,0]
  Specificity (mean): [0.0,0.3,0.7]
  Complexity (max):   11
  Complexity (mean):  1.4

Declarations
----------------------------------------
  Total:              1089
  Unique:             344 (31.6%)
  !important:         4 (0.4%)

Duplication
----------------------------------------
                    Total  Unique   Dupl.   Ratio
  Selectors           559     200     359   64.2%
  Declarations       1089     344     745   68.4%
  At-rules            149       5     144   96.6%
                  -------------------------------
  Total              1797     549    1248   69.4%
```

The duplication table shows the key bloat indicators: 69.4% of selectors, declarations, and at-rules are duplicated due to each package emitting its own copy of the Tailwind preflight, theme, and `@property` declarations.

## Scripts

```sh
pnpm dev         # Start all dev servers
pnpm build       # Build all packages and the web app
pnpm clean       # Remove all build artifacts and node_modules
pnpm analyze-css # Analyze the combined CSS output for duplication
pnpm lint        # Lint with Biome
pnpm check-types # Type-check all packages
```

## Tech Stack

- Turborepo
- pnpm workspaces
- Next.js 16
- Tailwind CSS v4
- TypeScript
- Biome
