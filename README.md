# Tailwind CSS Multi-Package Monorepo Experiment

This repo explores how Tailwind CSS v4 behaves in a Turborepo monorepo where **multiple packages each build their own CSS independently**. The goal is to understand the CSS duplication that occurs and evaluate remedies.

- **[FINDINGS.md](./FINDINGS.md)** — Detailed analysis of the CSS duplication problem
- **[REMEDIES.md](./REMEDIES.md)** — Three remediation strategies with measured results

## Structure

```
apps/
  web/              → Next.js 16 app (output: standalone)
packages/
  ui/               → Shared component library (Card, Gradient, TurborepoLogo)
  postcss-dedup/    → PostCSS deduplication plugin and CLI tool
  tailwind-config/  → Shared Tailwind theme and PostCSS config
  typescript-config/ → Shared TypeScript configs
features/
  feature-a/        → Feature package (Badge, Banner components)
  feature-b/        → Feature package (Badge, Banner components)
```

Each package (`ui`, `feature-a`, `feature-b`) and the web app all run independent Tailwind builds. Every build emits the full Tailwind boilerplate — preflight, theme, `@property` declarations — which gets duplicated when Next.js bundles everything together.

## The Problem

The baseline architecture produces **41.4 KB** of combined CSS with **69.4% structural duplication**. See [FINDINGS.md](./FINDINGS.md) for the full analysis.

## Remedies

Three approaches were tested, each on its own branch. See [REMEDIES.md](./REMEDIES.md) for full details, trade-offs, and implementation notes.

| Remedy | Approach | CSS Size | Reduction | Architecture Change |
|---|---|---|---|---|
| Baseline (`main`) | Per-package Tailwind builds | 41.4 KB | — | — |
| **A** (`remedy-a`) | Single app-level Tailwind build | 19.5 KB | **-52.9%** | Major — packages stop compiling CSS |
| **B** (`remedy-b`) | Post-build dedup on final CSS chunks | 26.2 KB | **-36.7%** | Minimal — one line added to build script |
| **C** (`remedy-c`) | `@reference` for utilities-only package builds | 26.6 KB | **-35.7%** | Minimal — 3-line change per package `styles.css` |

**Remedy A** achieves the best reduction but requires the biggest architecture change — packages no longer compile their own CSS. **Remedy B** and **C** achieve similar results (~36%) with minimal changes and can be combined for further improvement.

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
