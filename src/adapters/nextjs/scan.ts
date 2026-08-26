import fs from "node:fs";
import path from "node:path";
import { loadConfig, qualifyReachable, rel, walk } from "../shared.js";
import { classifyAuth, classifySensitive } from "../../core/classify.js";
import { inferAccess } from "../../core/access.js";
import { barrierApplies } from "../../core/middleware.js";
import { deriveFindings } from "../../core/findings.js";
import { extractModule } from "../extract.js";
import { createLoader, resolveCalls } from "../resolve.js";
import type {
  ApplicationSecurityModel,
  AuthSignal,
  ClientBoundary,
  EntryPoint,
  EnvironmentUsage,
  MiddlewareBarrier,
  SensitiveOperation,
} from "../../core/model.js";

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);

/**
 * Files Next.js treats as request-level middleware.
 *
 * `middleware` was renamed to `proxy` in v16 with the same semantics and the
 * same `config.matcher`. Both are recognized: a tool that only knew the old
 * name would silently stop seeing the barrier after a codemod, which is exactly
 * the kind of silent under-reporting this feature exists to remove.
 *
 * Next.js requires the file at the project root, or in `src/` — not nested
 * inside `app/`, where it would be an ordinary module of the same name.
 */
const MIDDLEWARE_FILES = new Set([
  "middleware.ts",
  "middleware.js",
  "middleware.tsx",
  "proxy.ts",
  "proxy.js",
  "proxy.tsx",
  "src/middleware.ts",
  "src/middleware.js",
  "src/middleware.tsx",
  "src/proxy.ts",
  "src/proxy.js",
  "src/proxy.tsx",
]);

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
  const loader = createLoader(root, extractModule);
  const files = walk(root);
  const entryPoints: EntryPoint[] = [];
  const clientBoundaries: ClientBoundary[] = [];
  const environment: EnvironmentUsage[] = [];
  const unparsedFiles: string[] = [];
  const barriers: MiddlewareBarrier[] = [];

  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const relative = rel(root, file);
    const module = extractModule(relative, text);
    if (module.hasSyntaxErrors) unparsedFiles.push(relative);

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

    // Middleware guards by path match rather than by being called, so it is
    // read once as an application-level barrier and never as an entry point.
    if (MIDDLEWARE_FILES.has(relative)) {
      const middlewareFn =
        module.functions.find((fn) => fn.name === "middleware" || fn.name === "proxy") ??
        module.functions.find((fn) => fn.name === "default") ??
        module.functions[0];

      if (middlewareFn) {
        const guards: AuthSignal[] = [];
        for (const call of resolveCalls(root, file, module, middlewareFn.calls, loader)) {
          const access = classifyAuth(call.name, config);
          if (!access) continue;
          guards.push({
            name: call.name,
            access,
            location: { file: relative, line: call.line },
            ...(call.via.length > 0 ? { via: call.via } : {}),
            source: "middleware",
          });
        }

        const routeConfig = module.routeConfig;
        // A middleware with no guard inside it protects nothing, and recording
        // it would let a later stage treat an empty barrier as evidence.
        if (guards.length > 0) {
          barriers.push({
            file: relative,
            access: inferAccess(guards),
            guards,
            matchers: routeConfig?.matchers ?? [],
            // No `config` export at all means Next.js runs it on every request.
            appliesToAll: !routeConfig || routeConfig.matchers.length === 0,
            conditional: Boolean(
              routeConfig?.hasDynamicMatcher || routeConfig?.hasRequestConditions,
            ),
            location: { file: relative, line: middlewareFn.line },
          });
        }
      }
      continue;
    }

    const isRoute = /\/route\.tsx?$/.test(file.split(path.sep).join("/"));
    for (const fn of module.functions) {
      const location = { file: relative, line: fn.line };
      const authSignals: AuthSignal[] = [];
      const sensitiveOperations: SensitiveOperation[] = [];

      // Follow the handler into what it calls. A thin delegating handler holds
      // no evidence itself; the guard is one or two calls deeper.
      const reachable = resolveCalls(root, file, module, fn.calls, loader);

      for (const call of reachable) {
        const callLocation = { file: relative, line: call.line };
        const access = classifyAuth(call.name, config);
        // `via` is the chain the resolver walked to reach this call. Recording
        // it is what lets `explain` show why an access level was concluded.
        if (access) {
          authSignals.push({
            name: call.name,
            access,
            location: callLocation,
            ...(call.via.length > 0 ? { via: call.via } : {}),
          });
        }
        const category = classifySensitive(call.name, config);
        if (category) sensitiveOperations.push({ expression: call.name, category, location: callLocation });
      }

      const shared = {
        reachableCalls: [...new Set(reachable.map((call) => call.name))],
        // Qualified by defining file, so two modules exporting the same name
        // stay distinct. Deduplicated on that identity, not on name alone.
        reachable: qualifyReachable(reachable),
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

  // Applied after the walk, because middleware may be read before or after the
  // routes it covers and the answer must not depend on filesystem order.
  //
  // Only route handlers are covered. Next.js documents that Server Functions
  // are not separate routes — they are POST requests to whatever route they are
  // used on — and warns that a matcher change or a refactor can silently remove
  // that coverage, recommending authorization inside each one. Crediting an
  // action with middleware protection would therefore assert something the
  // framework itself tells you not to rely on.
  for (const entry of entryPoints) {
    if (entry.kind !== "route-handler" || !entry.route) continue;
    for (const barrier of barriers) {
      if (!barrierApplies(barrier, entry.route)) continue;
      entry.authSignals.push(...barrier.guards);
    }
    entry.inferredAccess = inferAccess(entry.authSignals);
  }

  const base = {
    schemaVersion: 1 as const,
    generatedAt: new Date().toISOString(),
    root,
    framework: { name: "nextjs" as const, confidence: files.some((file) => file.includes(`${path.sep}app${path.sep}`)) ? 0.95 : 0.5 },
    entryPoints: entryPoints.sort((a, b) => a.id.localeCompare(b.id)),
    barriers: barriers.sort((a, b) => a.file.localeCompare(b.file)),
    unparsedFiles: unparsedFiles.sort(),
    clientBoundaries: clientBoundaries.sort((a, b) => a.file.localeCompare(b.file)),
    environment: environment.sort((a, b) => `${a.location.file}:${a.location.line}`.localeCompare(`${b.location.file}:${b.location.line}`)),
  };

  return { ...base, findings: deriveFindings(base) };
}
