import fs from "node:fs";
import path from "node:path";
import { scanNextProject } from "./nextjs/scan.js";
import { scanSvelteKitProject } from "./sveltekit/scan.js";
import type { ApplicationSecurityModel, FrameworkName } from "../core/model.js";

/**
 * Picks the adapter for a project.
 *
 * Detection reads `package.json` dependencies first — the framework a project
 * declares is stronger evidence than a directory that happens to be named
 * `app/`. Layout is the fallback for projects without a manifest.
 *
 * `package.json` is parsed as JSON, never imported, so nothing is executed.
 */

export class AdapterError extends Error {}

function dependencyNames(root: string): Set<string> {
  const manifest = path.join(root, "package.json");
  if (!fs.existsSync(manifest)) return new Set();
  try {
    const parsed = JSON.parse(fs.readFileSync(manifest, "utf8")) as Record<string, unknown>;
    const names = new Set<string>();
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
      const block = parsed[field];
      if (typeof block === "object" && block !== null && !Array.isArray(block)) {
        for (const name of Object.keys(block)) names.add(name);
      }
    }
    return names;
  } catch {
    // A malformed manifest is not fatal: fall back to layout detection.
    return new Set();
  }
}

function hasDirectory(root: string, ...segments: string[]): boolean {
  const target = path.join(root, ...segments);
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

export function detectFramework(root: string): FrameworkName | undefined {
  const dependencies = dependencyNames(root);
  if (dependencies.has("@sveltejs/kit")) return "sveltekit";
  if (dependencies.has("next")) return "nextjs";

  // No manifest, or a manifest that names neither: fall back to layout.
  if (hasDirectory(root, "src", "routes")) return "sveltekit";
  if (hasDirectory(root, "app") || hasDirectory(root, "src", "app")) return "nextjs";
  return undefined;
}

/** Builds a model using whichever adapter fits, or the one named explicitly. */
export function scanProject(root: string, framework?: FrameworkName): ApplicationSecurityModel {
  const chosen = framework ?? detectFramework(root);
  if (!chosen) {
    throw new AdapterError(
      `Could not tell which framework ${root} uses.\n` +
        `Pass --framework nextjs or --framework sveltekit to say explicitly.`,
    );
  }
  return chosen === "sveltekit" ? scanSvelteKitProject(root) : scanNextProject(root);
}
