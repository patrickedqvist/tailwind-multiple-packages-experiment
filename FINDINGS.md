# CSS Duplication in Multi-Package Tailwind Builds

## 1. Introduction

During routine performance analysis of a production web application, an unusually high amount of unused CSS was observed.

Initial investigation suggested the root cause was architectural rather than incidental. The application is built as a Next.js frontend consuming feature packages from our Pilar monorepo, each of which independently compiles its own Tailwind CSS bundle. This paper presents a controlled experiment to isolate and measure the cost of this pattern.

The goal is not to propose solutions — which will be addressed in a separate RFC — but to produce a clear, evidence-based understanding of the problem and its magnitude.

## 2. The Experiment

The experiment mimics our production setup with minimal packages to make duplication easy to trace.

The repo is available here https://github.com/patrickedqvist/tailwind-multiple-packages-experiment

The main things to note are:

- **`@repo/tailwind-config`** — Shared config exporting `shared-styles.css` (contains `@import "tailwindcss"` + a `@theme` block with custom colour tokens)
- **`features/feature-a`** and **`features/feature-b`** — Two feature packages, each with its own `@tailwindcss/cli` build that imports both `tailwindcss` and the shared config. Each uses a set of common utility classes plus one unique class (`bg-blue-100` and `bg-blue-200` respectively).
- **`apps/web`** — A Next.js app consuming both features, with its own `globals.css` also importing `tailwindcss` + the shared tailwind-config.

The built CSS output was analysed using [`@projectwallace/css-analyzer`](https://github.com/projectwallace/css-analyzer) to measure duplication across selectors, declarations, and at-rules. The compiled CSS from each package was also inspected directly to categorise its contents by layer.

## 3. What Each Tailwind Build Emits

Every package that runs `@import "tailwindcss"` produces a full standalone CSS bundle. A single build contains the following layers, regardless of how few utility classes the package actually uses:

| Layer | Contents | Size |
|---|---|---|
| `@layer properties` | `@property` declarations for Tailwind's internal CSS custom properties | ~3.4 KB |
| `@layer theme` | CSS custom properties for colours, spacing, fonts, radii, etc. | ~3.0 KB |
| `@layer base` | Preflight/reset — normalises elements, sets box-sizing, font inheritance, etc. | ~16.5 KB |
| `@layer utilities` | Only the utility classes actually used by the package's components | Varies |

The first three layers are **identical** across every package that shares the same `@repo/tailwind-config`. Only the utilities layer differs.

## 4. How Duplication Occurs

When Next.js bundles the application, it concatenates the CSS from every package into a single stylesheet. Because each package emitted its own full copy of the Tailwind boilerplate, the final output contains those layers repeated once per package.

In our experiment with three packages (feature-a, feature-b, and the web app itself), the built CSS contains:

- 3 copies of `@layer base` (preflight/reset)
- 3 copies of `@layer theme` (theme variables)
- 3 copies of `@layer properties` (`@property` declarations)

The utility classes are the only part that differs between packages, and they account for a small fraction of the total output.

## 5. Measured Results

### 5.1 Byte-Level Analysis

Direct inspection of the built CSS file, splitting by `@layer properties` boundaries:

| | Size |
|---|---|
| Total combined CSS | 41.4 KB |
| `@layer base` (x3 identical copies) | 16.5 KB each, **33 KB wasted** |
| `@layer theme` (x3 identical copies) | 3.0 KB each, **6 KB wasted** |
| `@layer properties` (x3 identical copies) | 3.4 KB each, **6.8 KB wasted** |
| **Total duplicated boilerplate** | **~46 KB (56% of file)** |
| Unique utility classes (all packages combined) | ~12.5 KB |

### 5.2 Structural Analysis

Using [`@projectwallace/css-analyzer`](https://github.com/projectwallace/css-analyzer) on the combined CSS output:

```
Stylesheet
  Size:               42,435 bytes
  Source lines:       1,797

Rules
  Total:              423

Selectors
  Total:              559
  Unique:             200
  Uniqueness ratio:   35.8%

Declarations
  Total:              1,089
  Unique:             344 (31.6%)
  !important:         4 (0.4%)
```

### 5.3 Duplication Summary

The analyzer confirms that the majority of selectors, declarations, and at-rules in the output are redundant:

| | Total | Unique | Duplicated | Ratio |
|---|---|---|---|---|
| Selectors | 559 | 200 | 359 | 64.2% |
| Declarations | 1,089 | 344 | 745 | 68.4% |
| At-rules | 149 | 5 | 144 | 96.6% |
| **Total** | **1,797** | **549** | **1,248** | **69.4%** |

At-rules are 96.6% duplicated because the same `@layer`, `@property`, and `@supports` blocks are emitted by every package. Selectors and declarations follow at 64–68% duplication, driven by the triplicated preflight reset rules.

## 6. Impact

### Download & Parse Cost

Every byte of duplicated CSS is downloaded, parsed, and evaluated by the browser — even though it has no effect after the first copy. In this minimal experiment the waste is ~46 KB. In a production monorepo with more feature packages, this scales linearly with the number of packages.

### Cache Invalidation

Because Next.js hashes the CSS filename based on content, any change in any package's utilities will produce a new hash, forcing a full re-download of the entire stylesheet — including all the duplicated boilerplate.

### Developer Experience

The inflated CSS makes it harder to audit stylesheets, debug specificity issues, and reason about what CSS is actually being shipped.

## 7. Conclusion

The current architecture — where each package independently compiles Tailwind CSS — results in **69.4% structural duplication** in the combined output. The Tailwind preflight, theme, and property layers are emitted identically by every package and concatenated verbatim into the final stylesheet.

This is not a bug in Tailwind or Next.js. It is a consequence of treating each package as a standalone CSS compilation unit. Solutions will be explored in a follow-up RFC.

## Appendix: Reproducing These Results

```sh
git clone https://github.com/patrickedqvist/tailwind-multiple-packages-experiment
cd tailwind-multiple-packages-experiment
pnpm install
pnpm build
pnpm analyze-css        # Human-readable report
pnpm analyze-css --json # Full JSON output
```
