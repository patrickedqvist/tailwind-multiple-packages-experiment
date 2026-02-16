/**
 * postcss-dedup — Remove duplicate CSS from concatenated stylesheets.
 *
 * When multiple packages each compile their own Tailwind CSS, the final
 * concatenated output contains a lot of exact-duplicate rules (preflight,
 * theme variables, utilities used by more than one package, etc.).
 *
 * This plugin removes those duplicates in two passes:
 *
 *   Pass 1 — Whole-rule dedup
 *   Removes rules that are identical in every respect: same selector,
 *   same declarations (order-independent), and same at-rule context.
 *
 *     INPUT                          OUTPUT
 *     ─────                          ──────
 *     .btn { color: red; }           .btn { color: red; }
 *     .btn { color: red; }           (removed — exact duplicate)
 *
 *   Context matters — the same rule inside different @layer or @media
 *   blocks is NOT considered a duplicate:
 *
 *     @layer base  { .a { color: red; } }   ← kept
 *     @layer utils { .a { color: red; } }   ← kept (different layer)
 *
 *   This pass also handles declaration-only at-rules like @property and
 *   @font-face:
 *
 *     @property --color { syntax: "<color>"; inherits: false; }
 *     @property --color { syntax: "<color>"; inherits: false; }
 *     → second one removed
 *
 *   Pass 2 — Declaration-level dedup
 *   After whole-rule dedup, there may still be rules with the SAME
 *   selector and context that share SOME declarations but not all.
 *   This pass strips the shared declarations from later rules.
 *
 *     INPUT                          OUTPUT
 *     ─────                          ──────
 *     .btn { color: red;             .btn { color: red;
 *            margin: 0; }                   margin: 0; }
 *     .btn { color: red;             .btn { padding: 8px; }
 *            padding: 8px; }           (color: red removed — seen above)
 *
 *   If ALL declarations in a rule are duplicates, the rule is removed
 *   entirely:
 *
 *     .btn { color: red; margin: 0; }    ← kept (first occurrence)
 *     .btn { color: red; }               ← removed (all decls are dupes)
 *
 *   This is particularly effective for Tailwind's @layer properties
 *   blocks, where each package emits the same @supports wrapper and
 *   wildcard selector but with overlapping custom property fallbacks.
 *
 * Both passes are context-aware. "Context" means the full chain of
 * ancestor at-rules (e.g. @layer properties > @supports (display: grid)).
 * Two rules are only compared if they share the exact same context.
 *
 * First occurrence always wins. Empty at-rule containers left behind
 * after removals are cleaned up automatically.
 */

import { createHash } from "node:crypto";
import postcss from "postcss";

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Build the at-rule context string for a node by walking up the AST.
 *
 * Example: a rule inside `@layer properties { @supports (...) { ... } }`
 * returns "layer:properties|supports:(display: grid)"
 *
 * Two nodes with the same context string are inside the same nesting
 * structure and can be compared for deduplication.
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
 * Serialize ALL direct child declarations of a node into a sorted,
 * deterministic string. Used by Pass 1 to fingerprint an entire rule.
 *
 * Sorting means declaration order doesn't matter:
 *   { color: red; margin: 0 }  ===  { margin: 0; color: red }
 */
function serializeDeclarations(node) {
  const decls = [];
  for (const child of node.nodes) {
    if (child.type === "decl") {
      decls.push(`${child.prop}:${child.value}${child.important ? "!important" : ""}`);
    }
  }
  decls.sort();
  return decls.join(";");
}

/**
 * Serialize a single declaration. Used by Pass 2 to track individual
 * property-value pairs across same-selector rules.
 */
function serializeDecl(decl) {
  return `${decl.prop}:${decl.value}${decl.important ? "!important" : ""}`;
}

/**
 * SHA-256 hash of a string. Used to keep the seen-set memory-efficient
 * when processing large stylesheets.
 */
function hash(str) {
  return createHash("sha256").update(str).digest("hex");
}

/**
 * Recursively remove at-rule containers that have no children left.
 * This cleans up empty wrappers like `@layer base {}` after their
 * contents were removed by deduplication.
 */
function removeEmptyAtRules(root) {
  let changed = true;
  while (changed) {
    changed = false;
    root.walkAtRules((atRule) => {
      if (atRule.nodes !== undefined && atRule.nodes.length === 0) {
        atRule.remove();
        changed = true;
      }
    });
  }
}

// ─── Pass 2: Declaration-Level Dedup ────────────────────────────────

/**
 * For rules that share the same selector AND at-rule context, remove
 * individual declarations that were already seen in an earlier rule.
 *
 * Example — two @layer properties blocks from different packages:
 *
 *   @layer properties {
 *     @supports (display: grid) {
 *       *, :before, :after {
 *         --tw-border-style: solid;    ← seen first here
 *         --tw-shadow: 0 0 #0000;
 *       }
 *     }
 *   }
 *   @layer properties {
 *     @supports (display: grid) {
 *       *, :before, :after {
 *         --tw-border-style: solid;    ← duplicate, removed
 *         --tw-blur: initial;          ← unique, kept
 *       }
 *     }
 *   }
 */
function deduplicateDeclarations(root) {
  // Map from "context|selector" → Set of seen declaration strings
  const seenDecls = new Map();

  root.walk((node) => {
    if (!node.parent) return;
    if (node.type !== "rule") return;

    const context = getAtRuleContext(node);
    const groupKey = `${context}|${node.selector}`;

    if (!seenDecls.has(groupKey)) {
      seenDecls.set(groupKey, new Set());
    }
    const seen = seenDecls.get(groupKey);

    // Check each direct child declaration (not nested — only immediate children)
    const toRemove = [];
    for (const child of node.nodes) {
      if (child.type !== "decl") continue;
      const key = serializeDecl(child);
      if (seen.has(key)) {
        toRemove.push(child);
      } else {
        seen.add(key);
      }
    }

    for (const child of toRemove) {
      child.remove();
    }

    // If every declaration was a duplicate, remove the now-empty rule
    const hasDecls = node.nodes && node.nodes.some((c) => c.type === "decl");
    if (!hasDecls) {
      node.remove();
    }
  });
}

// ─── Plugin ─────────────────────────────────────────────────────────

const plugin = () => {
  return {
    postcssPlugin: "postcss-dedup",
    Once(root) {
      // ── Pass 1: Whole-rule dedup ──────────────────────────────
      // Build a fingerprint for each rule from its context, selector,
      // and sorted declarations. If we've seen the fingerprint before,
      // the rule is an exact duplicate and gets removed.
      const seen = new Set();

      root.walk((node) => {
        // Nodes may be detached from the tree by a prior removal
        // during this same walk — skip them.
        if (!node.parent) return;

        let key;

        if (node.type === "rule") {
          // Regular rules: .btn { ... }, *, :before, :after { ... }
          const context = getAtRuleContext(node);
          const selector = node.selector;
          const decls = serializeDeclarations(node);
          key = `rule|${context}|${selector}|${decls}`;
        } else if (
          node.type === "atrule" &&
          node.nodes !== undefined &&
          node.nodes.length > 0 &&
          node.nodes.every((child) => child.type === "decl")
        ) {
          // Declaration-only at-rules: @property, @font-face, etc.
          const context = getAtRuleContext(node);
          const decls = serializeDeclarations(node);
          key = `atrule|${context}|${node.name}:${node.params}|${decls}`;
        } else {
          return;
        }

        const h = hash(key);
        if (seen.has(h)) {
          node.remove();
        } else {
          seen.add(h);
        }
      });

      // ── Pass 2: Declaration-level dedup ───────────────────────
      // After whole-rule dedup, handle rules that share a selector
      // and context but have partially overlapping declarations.
      deduplicateDeclarations(root);

      // ── Cleanup ───────────────────────────────────────────────
      // Remove any @layer, @media, @supports wrappers left empty
      // after their contents were deduplicated away.
      removeEmptyAtRules(root);
    },
  };
};

plugin.postcss = true;

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Deduplicate a CSS string. Returns the deduplicated CSS.
 *
 * Usage:
 *   import { dedup } from "@repo/postcss-dedup";
 *   const output = await dedup(inputCss);
 */
export async function dedup(css) {
  const result = await postcss([plugin]).process(css, { from: undefined });
  return result.css;
}

export default plugin;
