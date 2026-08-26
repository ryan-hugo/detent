import fs from "node:fs";
import path from "node:path";
import { loadConfig, rel, walk } from "../shared.js";
import { classifyAuth, classifySensitive } from "../../core/classify.js";
import { inferAccess } from "../../core/access.js";
import { deriveFindings } from "../../core/findings.js";
import { extractModule } from "../extract.js";
import { createLoader, resolveCalls } from "../resolve.js";
import type {
  ApplicationSecurityModel,
  AuthSignal,
  ClientBoundary,
  EntryPoint,
  EnvironmentUsage,
  SensitiveOperation,
} from "../../core/model.js";

/**
 * SvelteKit adapter.
 *
 * Three entry-point shapes, all conventions of the framework rather than
 * inferences about it:
 *
 * - `+server.ts` exporting HTTP method names — a route handler;
 * - `+page.server.ts` exporting `actions = { … }` — form actions, one entry
 *   point per key, reachable by POST from the browser;
 * - `+page.server.ts` / `+layout.server.ts` exporting `load` — runs on the
 *   server for every render of that route.
 *
 * The client boundary differs from Next.js: SvelteKit splits by filename, not
 * by directive. Anything not `.server.` in a route can reach the browser, and
 * `$env/static/public` (or a `PUBLIC_` prefix) is the exposed-secret analogue
 * of `NEXT_PUBLIC_`.
 */

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);

/** True when the file is one SvelteKit only ever runs on the server. */
function isServerOnly(file: string): boolean {
  return /(\+server|\+page\.server|\+layout\.server|hooks\.server)\.(ts|js)$/.test(file);
}

/**
 * Route path from a file under `routes/`, dropping SvelteKit's grouping
 * `(group)` segments the same way Next.js route groups are dropped.
 */
function routeFromFile(relative: string): string | undefined {
  const match = relative.match(/(?:^|\/)routes\/(.*)\/\+(?:server|page\.server|layout\.server)\.(?:ts|js)$/);
  if (!match) {
    // A handler directly at the routes root has no intermediate segments.
    return /(?:^|\/)routes\/\+(?:server|page\.server|layout\.server)\.(?:ts|js)$/.test(relative)
      ? "/"
      : undefined;
  }
  const segments = (match[1] ?? "")
    .split("/")
    .filter(Boolean)
    .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")));
  return `/${segments.join("/")}`.replace(/\/+/g, "/");
}

/** SvelteKit exposes public env through `$env/static/public` or a PUBLIC_ prefix. */
function isPublicEnv(name: string, imports: { local: string; from: string }[]): boolean {
  if (name.startsWith("PUBLIC_")) return true;
  return imports.some((binding) => binding.local === name && binding.from.includes("$env/static/public"));
}

export function scanSvelteKitProject(projectRoot: string): ApplicationSecurityModel {
  const root = path.resolve(projectRoot);
  if (!fs.existsSync(root)) throw new Error(`Project root does not exist: ${root}`);

  const config = loadConfig(root);
  const loader = createLoader(root, extractModule);
  const files = walk(root);
  const entryPoints: EntryPoint[] = [];
  const clientBoundaries: ClientBoundary[] = [];
  const environment: EnvironmentUsage[] = [];

  for (const file of files) {
    const relative = rel(root, file);
    const inRoutes = /(?:^|\/)routes\//.test(relative);
    const serverOnly = isServerOnly(relative);
    if (!inRoutes && !/hooks\.server\.(ts|js)$/.test(relative)) continue;

    const module = extractModule(relative, fs.readFileSync(file, "utf8"));

    for (const read of module.envReads) {
      environment.push({
        name: read.name,
        clientVisible: isPublicEnv(read.name, module.imports),
        // In SvelteKit a route file that is not `.server.` ships to the browser.
        fileIsClient: !serverOnly,
        location: { file: relative, line: read.line },
      });
    }

    if (!serverOnly) {
      clientBoundaries.push({ file: relative, exportedNames: module.functions.map((fn) => fn.name) });
      continue; // client files hold no server entry points
    }

    const route = routeFromFile(relative);
    const isEndpoint = /\+server\.(ts|js)$/.test(relative);

    for (const fn of module.functions) {
      const isMethod = isEndpoint && METHODS.has(fn.name);
      const isFormAction = fn.name.startsWith("actions.");
      const isLoad = fn.name === "load";
      if (!isMethod && !isFormAction && !isLoad) continue;

      const reachable = resolveCalls(root, file, module, fn.calls, loader);
      const authSignals: AuthSignal[] = [];
      const sensitiveOperations: SensitiveOperation[] = [];

      for (const call of reachable) {
        const callLocation = { file: relative, line: call.line };
        const access = classifyAuth(call.name, config);
        if (access) authSignals.push({ name: call.name, access, location: callLocation });
        const category = classifySensitive(call.name, config);
        if (category) sensitiveOperations.push({ expression: call.name, category, location: callLocation });
      }

      const shared = {
        location: { file: relative, line: fn.line },
        directives: module.moduleDirectives,
        authSignals,
        inferredAccess: inferAccess(authSignals),
        sensitiveOperations,
        reachableCalls: [...new Set(reachable.map((call) => call.name))],
      };

      if (isMethod) {
        entryPoints.push({
          id: `route:${fn.name}:${route ?? relative}`,
          kind: "route-handler",
          method: fn.name,
          exportName: fn.name,
          ...(route ? { route } : {}),
          ...shared,
        });
      } else {
        // Form actions and server `load` are both server functions the browser
        // can reach, which is what `server-action` means in the model.
        entryPoints.push({
          id: `action:${relative}:${fn.name}`,
          kind: "server-action",
          exportName: fn.name,
          ...(route ? { route } : {}),
          ...shared,
        });
      }
    }
  }

  const base = {
    schemaVersion: 1 as const,
    generatedAt: new Date().toISOString(),
    root,
    framework: { name: "sveltekit" as const, confidence: entryPoints.length > 0 ? 0.95 : 0.5 },
    entryPoints: entryPoints.sort((a, b) => a.id.localeCompare(b.id)),
    clientBoundaries: clientBoundaries.sort((a, b) => a.file.localeCompare(b.file)),
    environment: environment.sort((a, b) =>
      `${a.location.file}:${a.location.line}`.localeCompare(`${b.location.file}:${b.location.line}`),
    ),
  };

  return { ...base, findings: deriveFindings(base) };
}
