import fs from "node:fs";
import path from "node:path";
import { inferAccess } from "../../core/access.js";
import { deriveFindings } from "../../core/findings.js";
import { CONFIG_FILENAME, ConfigError, EMPTY_CONFIG, parseConfig } from "../../core/config.js";
import type { DetentConfig } from "../../core/config.js";
import { extractModule } from "./extract.js";
import type {
  AccessLevel,
  ApplicationSecurityModel,
  AuthSignal,
  ClientBoundary,
  EntryPoint,
  EnvironmentUsage,
  SensitiveOperation,
} from "../../core/model.js";

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", ".git", "coverage"]);

/**
 * Collects scannable files under `root`.
 *
 * Directory symlinks are not followed. A link pointing at an ancestor turns the
 * walk into an infinite descent that invents one phantom route per level, and a
 * link pointing outside `root` would scan a tree the user did not ask about.
 * Neither is worth the rare monorepo that links its packages.
 */
function walk(root: string, depth = 0): string[] {
  if (depth > 40) return []; // pathological nesting, not real project layout
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, depth + 1));
    else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

function rel(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

/** Last segment of a dotted callee, so `guards.requireAdmin` matches `requireAdmin`. */
function baseName(name: string): string {
  const parts = name.split(".");
  return parts[parts.length - 1] ?? name;
}

function classifyAuth(name: string, config: DetentConfig): AccessLevel | undefined {
  // An explicit denial always wins, including over the built-in detectors.
  if (config.notGuards.includes(name) || config.notGuards.includes(baseName(name))) {
    return undefined;
  }
  // An explicit mapping is stronger evidence than a name heuristic.
  const configured = config.guards[name] ?? config.guards[baseName(name)];
  if (configured) return configured;

  // Match whole words, not substrings. Real code is full of names that merely
  // contain these letters — `oAuthAppSchema.parse` is a Zod validator and
  // `stripe.billingPortal.sessions.create` opens a payment session; neither is
  // an authorization barrier, and believing them repeats the dead-text bug.
  const words = baseName(name)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  const joined = words.join(" ");

  if (words.includes("admin")) return "admin";
  if (words.some((word) => ["auth", "authenticate", "authorize", "session", "protect"].includes(word))) {
    return "authenticated";
  }
  if (/\b(current|require|get|ensure) user\b/.test(joined)) return "authenticated";
  return undefined;
}

function classifySensitive(name: string, config: DetentConfig): SensitiveOperation["category"] | undefined {
  const configured = config.sensitive[name] ?? config.sensitive[baseName(name)];
  if (configured) return configured;

  if (/stripe\.(refunds|paymentIntents|charges)\./i.test(name)) return "payment";
  if (/\.(create|update|delete|upsert|execute|executeRaw)$/i.test(name) && /(db|prisma|database|repo|repository)/i.test(name)) return "database-write";
  if (/^(fs\.|.*\.writeFile|.*\.rm|.*\.unlink)/i.test(name)) return "filesystem";
  if (/(exec|spawn|execFile)$/i.test(name)) return "process";
  return undefined;
}

/**
 * Reads `detent.config.json` from the project root, if present.
 * The file is parsed as JSON — never imported — so it cannot execute code.
 */
function loadConfig(root: string): DetentConfig {
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

function routeFromFile(root: string, file: string): string | undefined {
  const normalized = rel(root, file);
  const match = normalized.match(/(?:^|\/)app\/(.*)\/route\.tsx?$/);
  if (!match) return undefined;
  const segments = (match[1] ?? "")
    .split("/")
    .filter(Boolean)
    .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")));
  return `/${segments.join("/")}`.replace(/\/+/g, "/");
}

export function scanNextProject(projectRoot: string): ApplicationSecurityModel {
  const root = path.resolve(projectRoot);
  if (!fs.existsSync(root)) throw new Error(`Project root does not exist: ${root}`);

  const config = loadConfig(root);
  const files = walk(root);
  const entryPoints: EntryPoint[] = [];
  const clientBoundaries: ClientBoundary[] = [];
  const environment: EnvironmentUsage[] = [];

  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const relative = rel(root, file);
    const module = extractModule(relative, text);

    const isClient = module.moduleDirectives.includes("use client");
    const isServerModule = module.moduleDirectives.includes("use server");

    for (const read of module.envReads) {
      environment.push({
        name: read.name,
        clientVisible: read.name.startsWith("NEXT_PUBLIC_"),
        fileIsClient: isClient,
        location: { file: relative, line: read.line },
      });
    }

    if (isClient) {
      clientBoundaries.push({ file: relative, exportedNames: module.functions.map((fn) => fn.name) });
    }

    const isRoute = /\/route\.tsx?$/.test(file.split(path.sep).join("/"));
    for (const fn of module.functions) {
      const location = { file: relative, line: fn.line };
      const authSignals: AuthSignal[] = [];
      const sensitiveOperations: SensitiveOperation[] = [];

      for (const call of fn.calls) {
        const callLocation = { file: relative, line: call.line };
        const access = classifyAuth(call.name, config);
        if (access) authSignals.push({ name: call.name, access, location: callLocation });
        const category = classifySensitive(call.name, config);
        if (category) sensitiveOperations.push({ expression: call.name, category, location: callLocation });
      }

      const shared = {
        location,
        directives: module.moduleDirectives,
        authSignals,
        inferredAccess: inferAccess(authSignals),
        sensitiveOperations,
      };

      if (isRoute && METHODS.has(fn.name)) {
        const route = routeFromFile(root, file);
        entryPoints.push({
          id: `route:${fn.name}:${route ?? relative}`,
          kind: "route-handler",
          method: fn.name,
          exportName: fn.name,
          ...(route ? { route } : {}),
          ...shared,
        });
      } else if (isServerModule || fn.isInlineServerAction) {
        // A module-level directive exports every function as an action; an
        // inline directive exports only the function that carries it.
        entryPoints.push({
          id: `action:${relative}:${fn.name}`,
          kind: "server-action",
          exportName: fn.name,
          ...shared,
        });
      }
    }
  }

  const base = {
    schemaVersion: 1 as const,
    generatedAt: new Date().toISOString(),
    root,
    framework: { name: "nextjs" as const, confidence: files.some((file) => file.includes(`${path.sep}app${path.sep}`)) ? 0.95 : 0.5 },
    entryPoints: entryPoints.sort((a, b) => a.id.localeCompare(b.id)),
    clientBoundaries: clientBoundaries.sort((a, b) => a.file.localeCompare(b.file)),
    environment: environment.sort((a, b) => `${a.location.file}:${a.location.line}`.localeCompare(`${b.location.file}:${b.location.line}`)),
  };

  return { ...base, findings: deriveFindings(base) };
}
