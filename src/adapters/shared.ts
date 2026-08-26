import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILENAME, ConfigError, EMPTY_CONFIG, parseConfig } from "../core/config.js";
import type { DetentConfig } from "../core/config.js";
import type { ReachableCall } from "../core/model.js";
import type { ResolvedCall } from "./resolve.js";

/**
 * Filesystem and configuration plumbing shared by every adapter.
 *
 * Kept out of the individual adapters so a second framework does not duplicate
 * the symlink guard or the config loader — and so a fix to either applies
 * everywhere at once.
 */

const SKIP_DIRS = new Set(["node_modules", ".next", ".svelte-kit", ".nuxt", "dist", "build", ".git", "coverage"]);
const MAX_DEPTH = 40;

/**
 * Collects scannable files under `root`.
 *
 * Directory symlinks are not followed. A link pointing at an ancestor turns the
 * walk into an infinite descent that invents one phantom entry point per level,
 * and a link pointing outside `root` would scan a tree the user did not ask
 * about. Neither is worth the rare monorepo that links its packages.
 */
export function walk(root: string, depth = 0): string[] {
  if (depth > MAX_DEPTH) return []; // pathological nesting, not real project layout
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, depth + 1));
    else if (entry.isFile() && /\.(ts|tsx|js|mjs)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Reachable calls keyed by defining file plus name, so two modules that each
 * export `requireUser` stay separate entities.
 *
 * When the same symbol is reached by more than one path, the shallowest wins:
 * it is the most direct route to it, and keeping every path would multiply
 * output without adding information. Sorted for a stable model.
 */
export function qualifyReachable(calls: ResolvedCall[]): ReachableCall[] {
  const byIdentity = new Map<string, ReachableCall>();
  for (const call of calls) {
    const callSite = call.definedIn ?? "";
    const key = `${callSite}#${call.name}`;
    const existing = byIdentity.get(key);
    if (existing && existing.depth <= call.depth) continue;
    byIdentity.set(key, { name: call.name, callSite, depth: call.depth, via: call.via });
  }
  return [...byIdentity.values()].sort(
    (a, b) => a.callSite.localeCompare(b.callSite) || a.name.localeCompare(b.name),
  );
}

/** Project-relative path with forward slashes, so model output is platform-stable. */
export function rel(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

/**
 * Reads `detent.config.json` from the project root, if present.
 * The file is parsed as JSON — never imported — so it cannot execute code.
 */
export function loadConfig(root: string): DetentConfig {
  const file = path.join(root, CONFIG_FILENAME);
  if (!fs.existsSync(file)) return EMPTY_CONFIG;
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (cause) {
    throw new ConfigError(`${CONFIG_FILENAME} is not valid JSON: ${(cause as Error).message}`);
  }
  try {
    return parseConfig(raw);
  } catch (cause) {
    throw new ConfigError(`${CONFIG_FILENAME}: ${(cause as Error).message}`);
  }
}
