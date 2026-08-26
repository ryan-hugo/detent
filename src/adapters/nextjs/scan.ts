import fs from "node:fs";
import path from "node:path";
import { loadConfig, rel, walk } from "../shared.js";
import { classifyAuth, classifySensitive } from "../../core/classify.js";
import { inferAccess } from "../../core/access.js";
import { deriveFindings } from "../../core/findings.js";
import { extractModule } from "../extract.js";
import { createLoader, resolveCalls } from "../resolve.js";
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
