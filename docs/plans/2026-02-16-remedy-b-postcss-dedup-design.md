# Remedy B: PostCSS Deduplication Plugin

## Problem

In a monorepo with Tailwind v4, each feature package runs an independent Tailwind build. When the app bundles CSS from all packages, boilerplate layers (`@layer base`, `@layer theme`, `@layer properties`) are duplicated per package. With 30+ packages today (potentially 100+), this creates significant CSS bloat.

The baseline with 3 packages shows 69.4% structural duplication and 41.4 KB combined CSS.

## Approach

Keep the existing per-package CSS build architecture. Add a PostCSS deduplication plugin that runs at the app level to strip exact duplicate CSS rules from the final bundle.

This differs from Remedy A (single app-level Tailwind build) by preserving package independence — each feature package still ships its own compiled CSS.

## Design

### Plugin: `@repo/postcss-dedup`

A PostCSS plugin that walks the CSS AST and removes exact duplicate rules. A rule is considered a duplicate when all of the following match a previously seen rule:

1. **Layer context** — which `@layer` the rule is inside (or none)
2. **Wrapping at-rules** — any `@media`, `@supports`, etc. surrounding the rule
3. **Selector** — the full selector string
4. **Declarations** — all property-value pairs, sorted by property name for determinism

The plugin hashes these four components into a key. First occurrence wins; subsequent identical rules are removed.

### Correctness guarantees

- Only exact duplicates are removed — no fuzzy matching
- Layer boundaries are respected — a rule in `@layer base` is never considered a duplicate of the same rule in `@layer utilities`
- At-rule context is preserved — `@media (min-width: 768px) { .foo { color: red } }` is distinct from `.foo { color: red }`
- Declaration order is normalized (sorted by property) for comparison, so `{ color: red; margin: 0 }` matches `{ margin: 0; color: red }`
- First occurrence always wins, preserving cascade order

### Package structure

```
packages/postcss-dedup/
  package.json
  index.mjs        — PostCSS plugin
  index.test.mjs   — tests
```

### Integration

The plugin is consumed **only by apps**, never by feature packages. Feature packages don't have duplication on their own — it only manifests when their CSS is combined at the app level.

```js
// apps/web/postcss.config.js
const { postcssConfig } = require("@repo/tailwind-config/postcss");
const dedup = require("@repo/postcss-dedup");

module.exports = {
  plugins: [
    ...postcssConfig.plugins,
    dedup,  // runs after Tailwind
  ],
};
```

### What stays the same

- Feature packages keep their own `styles.css` and `build:styles` / `dev:styles` scripts
- Shared `@repo/tailwind-config` is unchanged
- Component authoring is unchanged
- Packages can still ship pre-compiled CSS

### Validation

- Run `pnpm build` then `pnpm analyze-css` to measure duplication metrics
- Compare against baseline (69.4% duplication, 41.4 KB) and Remedy A (31.2%, 19.5 KB)
- Visual inspection: app must look identical before and after the plugin

## Trade-offs

| Aspect | Pro | Con |
|--------|-----|-----|
| Package independence | Packages keep their own CSS builds | CSS is compiled twice (per-package + app-level dedup) |
| Correctness | Only exact duplicates removed | Conservative — may miss near-duplicates |
| Scale | Hash-based, handles 100+ packages | Post-processing adds to build time |
| Adoption | Drop-in plugin, no architecture changes | Each app must add the plugin to its PostCSS config |

## Success criteria

- Overall CSS duplication drops significantly from the 69.4% baseline
- No visual regressions in the web app
- Plugin handles `@layer`, `@media`, `@supports` contexts correctly
- Works as a standard PostCSS plugin with no special bundler integration
