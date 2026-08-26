import fs from "node:fs";
import path from "node:path";
import type { ExtractedCall, ExtractedModule } from "./extract.js";

/**
 * Follows calls into the functions they reach.
 *
 * A handler that delegates — `export const POST = (req) => handleUpload(req)` —
 * carries no evidence of its own, so name matching alone reads it as unguarded.
 * The guard is one call deeper. Following that call is the difference between a
 * tool that fires on every thin handler and one that answers the real question.
 *
 * Resolution is syntactic and bounded: only local functions and relative or
 * alias imports inside the project, to a fixed depth, with cycle protection.
 * No module is executed and nothing outside the project root is read.
 */

const MAX_DEPTH = 3;
const EXTENSIONS = [".ts", ".tsx"] as const;

export interface ResolvedCall extends ExtractedCall {
  /** 0 for a call written in the handler, 1 for one call deeper, and so on. */
  depth: number;
  /** Chain of function names traversed to reach it, for evidence. */
  via: string[];
}

export interface ModuleLoader {
  /** Parsed module for an absolute file path, or undefined when unreadable. */
  load(file: string): ExtractedModule | undefined;
}

/** Reads and caches parsed modules, so a shared helper is parsed once. */
export function createLoader(
  root: string,
  parse: (fileName: string, text: string) => ExtractedModule,
): ModuleLoader {
  const cache = new Map<string, ExtractedModule | undefined>();
  return {
    load(file: string) {
      if (cache.has(file)) return cache.get(file);
      let module: ExtractedModule | undefined;
      try {
        // Never read outside the project: an import can name any path.
        const resolved = path.resolve(file);
        if (resolved !== root && !resolved.startsWith(root + path.sep)) {
          module = undefined;
        } else {
          module = parse(path.relative(root, resolved), fs.readFileSync(resolved, "utf8"));
        }
      } catch {
        module = undefined;
      }
      cache.set(file, module);
      return module;
    },
  };
}

/**
 * Turns a module specifier into a file path inside the project.
 * Handles relative imports and the common `@/…` alias; anything else — a bare
 * package name — is deliberately not followed.
 */
function resolveSpecifier(root: string, fromFile: string, specifier: string): string | undefined {
  let base: string;
  if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else if (specifier.startsWith("@/")) {
    base = path.resolve(root, specifier.slice(2));
  } else if (/^(lib|app|src|components|server|utils)\//.test(specifier)) {
    // Next.js projects commonly resolve these from the root via baseUrl.
    base = path.resolve(root, specifier);
  } else {
    return undefined;
  }

  for (const candidate of [
    ...EXTENSIONS.map((extension) => base + extension),
    ...EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** Last segment of a dotted callee: `guards.requireAdmin` → `requireAdmin`. */
function baseName(name: string): string {
  const parts = name.split(".");
  return parts[parts.length - 1] ?? name;
}

/**
 * Every call reachable from `calls`, including those inside functions they
 * invoke. Depth-limited and cycle-safe; unresolvable calls are simply not
 * followed, which keeps the result conservative rather than speculative.
 */
export function resolveCalls(
  root: string,
  file: string,
  module: ExtractedModule,
  calls: ExtractedCall[],
  loader: ModuleLoader,
): ResolvedCall[] {
  const out: ResolvedCall[] = calls.map((call) => ({ ...call, depth: 0, via: [] }));
  const seen = new Set<string>();

  const walk = (
    currentFile: string,
    currentModule: ExtractedModule,
    pending: ExtractedCall[],
    depth: number,
    via: string[],
  ): void => {
    if (depth >= MAX_DEPTH) return;

    for (const call of pending) {
      const name = baseName(call.name);
      const key = `${currentFile}#${name}`;
      if (seen.has(key)) continue;

      const local = currentModule.localFunctions.get(name);
      if (local) {
        seen.add(key);
        const chain = [...via, name];
        for (const inner of local.calls) {
          out.push({ ...inner, depth: depth + 1, via: chain });
        }
        walk(currentFile, currentModule, local.calls, depth + 1, chain);
        continue;
      }

      const binding = currentModule.imports.find((entry) => entry.local === name);
      if (!binding) continue;
      const target = resolveSpecifier(root, currentFile, binding.from);
      if (!target) continue;
      const imported = loader.load(target);
      if (!imported) continue;

      const fn = imported.localFunctions.get(name) ??
        imported.functions.find((candidate) => candidate.name === name);
      if (!fn) continue;

      seen.add(key);
      const chain = [...via, name];
      for (const inner of fn.calls) {
        out.push({ ...inner, depth: depth + 1, via: chain });
      }
      walk(target, imported, fn.calls, depth + 1, chain);
    }
  };

  walk(file, module, calls, 0, []);
  return out;
}
