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

## Scripts

```sh
pnpm dev        # Start all dev servers
pnpm build      # Build all packages and the web app
pnpm clean      # Remove all build artifacts and node_modules
pnpm lint       # Lint with Biome
pnpm check-types # Type-check all packages
```

## Tech Stack

- Turborepo
- pnpm workspaces
- Next.js 16
- Tailwind CSS v4
- TypeScript
- Biome
