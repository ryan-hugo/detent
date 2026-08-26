import type { AccessLevel, ApplicationSecurityModel, EntryPoint } from "./model.js";

/**
 * Adds reachability context to findings produced by another scanner.
 *
 * Semgrep and CodeQL answer "is this line dangerous". They cannot answer "can
 * an unauthenticated stranger reach it", because they have no model of the
 * application's entry points. Detent has exactly that, so the two compose:
 * their detection, our context.
 *
 * The point is triage. A SQL injection behind an admin guard and the same
 * injection on a public route are the same rule and very different problems,
 * and a severity field alone cannot tell them apart.
 *
 * Input is SARIF 2.1.0, which both tools emit. It is parsed as JSON and treated
 * as untrusted: shape is checked, nothing is executed, and a malformed result
 * is skipped rather than crashing the run.
 */

export class EnrichError extends Error {}

export interface ExternalFinding {
  ruleId: string;
  message: string;
  file: string;
  line: number;
}

export interface EnrichedFinding extends ExternalFinding {
  /** Weakest access level among entry points that can reach this file. */
  reachableAt?: AccessLevel;
  /** Entry point ids that reach it, for evidence. */
  reachedBy: string[];
  /**
   * Recomputed priority. A dangerous line nobody can reach from outside is not
   * the same emergency as one on a public route.
   */
  priority: "critical" | "high" | "medium" | "low";
}

const ACCESS_RANK: Record<AccessLevel, number> = {
  public: 0,
  unknown: 1,
  authenticated: 2,
  admin: 3,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Normalizes a SARIF uri to the model's forward-slash, root-relative form. */
function normalize(uri: string): string {
  return uri.replace(/^file:\/\//, "").replace(/^\.\//, "").split("\\").join("/");
}

/** Reads the results out of a SARIF document, skipping anything malformed. */
export function parseSarif(raw: unknown): ExternalFinding[] {
  if (!isObject(raw)) throw new EnrichError("SARIF input must be a JSON object");
  const runs = raw["runs"];
  if (!Array.isArray(runs)) throw new EnrichError('SARIF input has no "runs" array');

  const findings: ExternalFinding[] = [];
  for (const run of runs) {
    if (!isObject(run) || !Array.isArray(run["results"])) continue;
    for (const result of run["results"]) {
      if (!isObject(result)) continue;

      const locations = result["locations"];
      if (!Array.isArray(locations) || locations.length === 0) continue;
      const first = locations[0];
      if (!isObject(first)) continue;
      const physical = first["physicalLocation"];
      if (!isObject(physical)) continue;
      const artifact = physical["artifactLocation"];
      const region = physical["region"];
      if (!isObject(artifact) || typeof artifact["uri"] !== "string") continue;

      const line = isObject(region) && typeof region["startLine"] === "number" ? region["startLine"] : 0;
      const message = isObject(result["message"]) && typeof result["message"]["text"] === "string"
        ? result["message"]["text"]
        : "";

      findings.push({
        ruleId: typeof result["ruleId"] === "string" ? result["ruleId"] : "unknown",
        message,
        file: normalize(artifact["uri"]),
        line,
      });
    }
  }
  return findings;
}

/**
 * Entry points whose evidence touches a file.
 *
 * An entry point "reaches" a file when the model recorded a call or operation
 * there — which, with call resolution, includes helpers the handler delegates
 * to. This is deliberately coarser than dataflow: it says the file is on a
 * reachable path, not that the specific tainted value flows to it.
 */
function reachers(model: ApplicationSecurityModel, file: string): EntryPoint[] {
  return model.entryPoints.filter((entry) => {
    if (entry.location.file === file) return true;
    if (entry.sensitiveOperations.some((operation) => operation.location.file === file)) return true;
    return entry.authSignals.some((signal) => signal.location.file === file);
  });
}

export function enrichFindings(
  model: ApplicationSecurityModel,
  external: ExternalFinding[],
): EnrichedFinding[] {
  return external
    .map((finding) => {
      const reached = reachers(model, finding.file);
      if (reached.length === 0) {
        // Not on any known entry-point path. Still real, but not externally
        // reachable as far as the model can tell — say so rather than guess.
        return { ...finding, reachedBy: [], priority: "low" as const };
      }

      const weakest = reached.reduce((worst, entry) =>
        ACCESS_RANK[entry.inferredAccess] < ACCESS_RANK[worst.inferredAccess] ? entry : worst,
      );
      const reachableAt = weakest.inferredAccess;
      const priority =
        reachableAt === "public"
          ? ("critical" as const)
          : reachableAt === "unknown"
            ? ("high" as const)
            : reachableAt === "authenticated"
              ? ("medium" as const)
              : ("low" as const);

      return {
        ...finding,
        reachableAt,
        reachedBy: reached.map((entry) => entry.id).sort(),
        priority,
      };
    })
    .sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3 };
      return order[a.priority] - order[b.priority] || a.file.localeCompare(b.file);
    });
}
