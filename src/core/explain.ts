import type { AccessLevel, ApplicationSecurityModel, EntryPoint, SourceLocation } from "./model.js";

/**
 * Answers "why is this route classified the way it is".
 *
 * Every field here is read from the model the scanner already produced. Nothing
 * is inferred, re-classified, or ranked: `explain` reports the reasoning, it
 * does not perform any. That is what keeps it reproducible for a given tree.
 */

export class ExplainError extends Error {}

export interface EvidenceStep {
  /** The call that carried the evidence, e.g. `getServerSession`. */
  call: string;
  /** Access level this call establishes. */
  access: AccessLevel;
  /** Functions walked from the handler to reach it; empty when written inline. */
  via: string[];
  location: SourceLocation;
  /**
   * Set when the evidence came from middleware matching this route.
   *
   * Worth stating explicitly: the guard is in another file and nothing in the
   * handler shows it, so a reader who is not told will look for a barrier that
   * is not there.
   */
  source?: "middleware";
}

export interface Explanation {
  entryPointId: string;
  /** Route when the framework has one, otherwise the exported name. */
  subject: string;
  kind: EntryPoint["kind"];
  method?: string;
  location: SourceLocation;
  access: AccessLevel;
  /** Authorization evidence, strongest first. */
  evidence: EvidenceStep[];
  /** Operation categories reached from this entry point, deduplicated. */
  reaches: string[];
}

const ACCESS_RANK: Record<AccessLevel, number> = {
  public: 0,
  unknown: 1,
  authenticated: 2,
  admin: 3,
};

/** The identifier a user would type: the route, or the export when there is none. */
function subjectOf(entry: EntryPoint): string {
  return entry.route ?? entry.exportName;
}

/**
 * Entry points a query names.
 *
 * Matching is exact on route, entry-point id, or export name. A route with
 * several HTTP methods is several entry points, and all of them are returned —
 * answering for only one would hide a method the user did not think to ask about.
 */
export function findEntryPoints(model: ApplicationSecurityModel, query: string): EntryPoint[] {
  const wanted = query.trim();
  if (wanted.length === 0) return [];

  const exact = model.entryPoints.filter(
    (entry) => entry.id === wanted || entry.route === wanted || entry.exportName === wanted,
  );
  if (exact.length > 0) return exact;

  // A trailing slash is a natural thing to type and never meaningful here.
  const trimmed = wanted.replace(/\/+$/, "");
  return trimmed === wanted
    ? []
    : model.entryPoints.filter((entry) => entry.route === trimmed || entry.id === trimmed);
}

/** Subjects a user could ask about, for an error message that helps. */
export function knownSubjects(model: ApplicationSecurityModel): string[] {
  return [...new Set(model.entryPoints.map(subjectOf))].sort();
}

export function explainEntryPoint(entry: EntryPoint): Explanation {
  const evidence: EvidenceStep[] = entry.authSignals
    .map((signal) => ({
      call: signal.name,
      access: signal.access,
      via: signal.via ?? [],
      location: signal.location,
      ...(signal.source ? { source: signal.source } : {}),
    }))
    // Strongest evidence first: it is the one that decided `inferredAccess`.
    // Ties break on chain length, so a guard in the handler reads before one
    // reached through helpers.
    .sort(
      (a, b) =>
        ACCESS_RANK[b.access] - ACCESS_RANK[a.access] ||
        a.via.length - b.via.length ||
        a.call.localeCompare(b.call),
    );

  return {
    entryPointId: entry.id,
    subject: subjectOf(entry),
    kind: entry.kind,
    ...(entry.method ? { method: entry.method } : {}),
    location: entry.location,
    access: entry.inferredAccess,
    evidence,
    reaches: [...new Set(entry.sensitiveOperations.map((operation) => operation.category))].sort(),
  };
}

/**
 * Explains every entry point a query names.
 * Throws when nothing matches, so the caller can report it as a usage error.
 */
export function explain(model: ApplicationSecurityModel, query: string): Explanation[] {
  const matches = findEntryPoints(model, query);
  if (matches.length === 0) {
    throw new ExplainError(`No entry point matches ${JSON.stringify(query)}`);
  }
  return matches.map(explainEntryPoint);
}
