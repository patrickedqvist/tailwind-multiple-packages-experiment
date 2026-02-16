import { createHash } from "node:crypto";
import postcss from "postcss";

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
 * Serialize direct declarations of a node into a deterministic string.
 * Sorts by property name so { color: red; margin: 0 } === { margin: 0; color: red }.
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
      if (atRule.nodes !== undefined && atRule.nodes.length === 0) {
        atRule.remove();
        changed = true;
      }
    });
  }
}

/**
 * PostCSS plugin that removes exact duplicate CSS rules.
 */
const plugin = () => {
  return {
    postcssPlugin: "postcss-dedup",
    Once(root) {
      const seen = new Set();

      root.walk((node) => {
        // Skip nodes detached from the tree by a prior removal
        if (!node.parent) return;

        let key;

        if (node.type === "rule") {
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

      removeEmptyAtRules(root);
    },
  };
};

plugin.postcss = true;

/**
 * Deduplicate a CSS string. Returns the deduplicated CSS.
 */
export async function dedup(css) {
  const result = await postcss([plugin]).process(css, { from: undefined });
  return result.css;
}

export default plugin;
