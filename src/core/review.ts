import { explainEntryPoint } from "./explain.js";
import type { EvidenceStep } from "./explain.js";
import { impact, findSymbols } from "./impact.js";
import type { AccessLevel, ApplicationSecurityModel, EntryPoint } from "./model.js";

/**
 * Compares two real states of a project and reports what the change did to its
 * security posture.
 *
 * This deliberately replaces an earlier idea — synthetically deleting a symbol
 * and rescanning. That was rejected: removing a declaration leaves imports
 * pointing at nothing, which is a state that never compiles and never occurs,
 * and the classifier matches on the call rather than the declaration, so the
 * mutation frequently changed nothing at all. A wrong answer about a state that
 * cannot exist is worse than no answer.
 *
 * Everything here composes existing capabilities. Postures come from the
 * scanner, evidence from `explain`, dependency counts from `impact`. Nothing is
 * reclassified.
 */

/** A route absent from a model is not a public one. */
export const ABSENT = "absent" as const;
export type Posture = AccessLevel | typeof ABSENT;

const RANK: Record<Posture, number> = {
  absent: -1,
  public: 0,
  unknown: 1,
  authenticated: 2,
  admin: 3,
};

/**
 * How a posture moved. `absent` is its own state at both ends, so appearing and
 * disappearing are never mistaken for exposure.
 */
export type ChangeKind =
  | "regression"
  | "improvement"
  | "added-surface"
  | "added-protected-surface"
  | "removed-surface"
  | "evidence-only";

export interface PostureChange {
  subject: string;
  entryPointId: string;
  before: Posture;
  after: Posture;
  kind: ChangeKind;
  evidenceBefore: EvidenceStep[];
  evidenceAfter: EvidenceStep[];
  /** Guard names present before and gone after. */
  evidenceRemoved: string[];
  /** Guard names present after and absent before. */
  evidenceAdded: string[];
}

export interface DependencyContext {
  symbol: string;
  /** Entry points that reach it in the current state. */
  reachableCount: number;
  /** Entry points whose access level it decides in the current state. */
  securityEvidenceCount: number;
}

export interface ReviewResult {
  /** Postures that actually moved, proven by both models. */
  postureChanges: PostureChange[];
  /** Evidence that changed while the posture stayed put. */
  evidenceChanges: PostureChange[];
  /**
   * Symbols whose evidence changed somewhere, with how much depends on them.
   *
   * This is dependency, not consequence: a symbol eight routes rely on may have
   * changed the posture of only two. Those two are in `postureChanges`.
   */
  dependencies: DependencyContext[];
  regressionCount: number;
  improvementCount: number;
  /**
   * Files in the current state that did not parse.
   *
   * A route missing from a broken file is indistinguishable from a deleted
   * one, so a non-empty list means "no changes" cannot be trusted. Reporting
   * it is the difference between an incomplete analysis and a clean result.
   */
  unparsedFiles: string[];
}

function subjectOf(entry: EntryPoint): string {
  return entry.route ?? entry.exportName;
}

/** Weakest posture for an id present in a model, or ABSENT when it is not. */
function postureOf(model: ApplicationSecurityModel, id: string): { posture: Posture; evidence: EvidenceStep[] } {
  const entry = model.entryPoints.find((item) => item.id === id);
  if (!entry) return { posture: ABSENT, evidence: [] };
  return { posture: entry.inferredAccess, evidence: explainEntryPoint(entry).evidence };
}

/** Guard names in an evidence set, including the hops taken to reach them. */
function guardNames(evidence: EvidenceStep[]): Set<string> {
  const names = new Set<string>();
  for (const step of evidence) {
    names.add(step.call);
    for (const hop of step.via) names.add(hop);
  }
  return names;
}

function classify(before: Posture, after: Posture): ChangeKind | undefined {
  if (before === after) return undefined;
  if (before === ABSENT) return after === "public" ? "added-surface" : "added-protected-surface";
  if (after === ABSENT) return "removed-surface";
  return RANK[after] < RANK[before] ? "regression" : "improvement";
}

export function review(
  before: ApplicationSecurityModel,
  after: ApplicationSecurityModel,
): ReviewResult {
  const ids = [
    ...new Set([
      ...before.entryPoints.map((entry) => entry.id),
      ...after.entryPoints.map((entry) => entry.id),
    ]),
  ].sort();

  const postureChanges: PostureChange[] = [];
  const evidenceChanges: PostureChange[] = [];
  const changedSymbols = new Set<string>();

  for (const id of ids) {
    const from = postureOf(before, id);
    const to = postureOf(after, id);

    const beforeNames = guardNames(from.evidence);
    const afterNames = guardNames(to.evidence);
    const removed = [...beforeNames].filter((name) => !afterNames.has(name)).sort();
    const added = [...afterNames].filter((name) => !beforeNames.has(name)).sort();

    const subject =
      after.entryPoints.find((entry) => entry.id === id) ??
      before.entryPoints.find((entry) => entry.id === id);

    const record: PostureChange = {
      subject: subject ? subjectOf(subject) : id,
      entryPointId: id,
      before: from.posture,
      after: to.posture,
      kind: "evidence-only",
      evidenceBefore: from.evidence,
      evidenceAfter: to.evidence,
      evidenceRemoved: removed,
      evidenceAdded: added,
    };

    const kind = classify(from.posture, to.posture);
    if (kind) {
      postureChanges.push({ ...record, kind });
      for (const name of [...removed, ...added]) changedSymbols.add(name);
    } else if (removed.length > 0 || added.length > 0) {
      // The guard was swapped for another of equal strength. Worth showing,
      // but it is not a posture change and must not be counted as one.
      evidenceChanges.push(record);
      for (const name of [...removed, ...added]) changedSymbols.add(name);
    }
  }

  // Dependency context, measured on the current state. Reported apart from the
  // proven changes above, because reaching a symbol is not the same as having
  // been changed by it.
  const dependencies: DependencyContext[] = [];
  for (const symbol of [...changedSymbols].sort()) {
    const matches = findSymbols(after, symbol);
    if (matches.length === 0) continue;
    const result = impact(after, matches[0] as Parameters<typeof impact>[1]);
    if (result.reachableCount === 0) continue;
    dependencies.push({
      symbol,
      reachableCount: result.reachableCount,
      securityEvidenceCount: result.securityEvidenceCount,
    });
  }

  return {
    postureChanges,
    evidenceChanges,
    dependencies,
    unparsedFiles: after.unparsedFiles ?? [],
    regressionCount: postureChanges.filter((change) => change.kind === "regression").length,
    improvementCount: postureChanges.filter((change) => change.kind === "improvement").length,
  };
}
