import { listCommits, isShallow, withTree } from "./git.js";
import type { CommitInfo } from "./git.js";
import { explainEntryPoint, findEntryPoints } from "./explain.js";
import type { EvidenceStep } from "./explain.js";
import type { AccessLevel, ApplicationSecurityModel } from "./model.js";

/**
 * Finds when a route's security posture last changed.
 *
 * This is not `git blame`. It does not ask who edited a line; it asks which
 * commit the route stopped being `admin` at, which is a question about the
 * model rather than about text. The answer is produced by scanning historical
 * trees with the same scanner used everywhere else — posture is never
 * recomputed here, only compared.
 */

export class BlameError extends Error {}

/**
 * A route that does not exist is not a public route.
 *
 * Collapsing the two would report every newly added guarded route as having
 * "become public at some point", which is false and the most likely way this
 * feature could mislead someone.
 */
export const ABSENT = "absent" as const;

export type Posture = AccessLevel | typeof ABSENT;

export interface PostureAt {
  posture: Posture;
  evidence: EvidenceStep[];
}

export interface EvidenceDiff {
  /** Guard calls present before and gone after. */
  removed: string[];
  /** Guard calls present after and absent before. */
  added: string[];
}

export interface BlameResult {
  route: string;
  current: PostureAt;
  /** Posture immediately before the transition; absent when none was found. */
  previous?: PostureAt;
  /** The commit at which the current posture first appears, scanning backwards. */
  transition?: CommitInfo;
  evidenceDiff?: EvidenceDiff;
  /** Commits actually scanned, for an honest account of what was examined. */
  commitsScanned: number;
  /** True when history is truncated, so "no change" cannot mean "never changed". */
  historyIncomplete: boolean;
}

export interface BlameOptions {
  /** Upper bound on commits examined. Keeps a large repository usable. */
  maxCommits?: number;
  /** Git date expression, e.g. `30 days ago`. */
  since?: string;
  ref?: string;
}

const DEFAULT_MAX_COMMITS = 40;

/** Pathspecs that could possibly change a posture. See listCommits for why. */
const RELEVANT_PATHS = ["*.ts", "*.tsx", "*.json"];

/**
 * Posture of one route in one model.
 *
 * A route with several HTTP methods yields several entry points; the weakest is
 * used, because that is the posture an attacker meets. Evidence is taken from
 * that same entry point so the two always describe each other.
 */
function postureIn(model: ApplicationSecurityModel, route: string): PostureAt {
  const matches = findEntryPoints(model, route);
  if (matches.length === 0) return { posture: ABSENT, evidence: [] };

  const rank: Record<AccessLevel, number> = { public: 0, unknown: 1, authenticated: 2, admin: 3 };
  const weakest = matches.reduce((worst, entry) =>
    rank[entry.inferredAccess] < rank[worst.inferredAccess] ? entry : worst,
  );
  return {
    posture: weakest.inferredAccess,
    evidence: explainEntryPoint(weakest).evidence,
  };
}

/** Guard names in an evidence set, including the chain that reached them. */
function guardNames(evidence: EvidenceStep[]): Set<string> {
  const names = new Set<string>();
  for (const step of evidence) {
    names.add(step.call);
    for (const hop of step.via) names.add(hop);
  }
  return names;
}

function diffEvidence(before: EvidenceStep[], after: EvidenceStep[]): EvidenceDiff {
  const beforeNames = guardNames(before);
  const afterNames = guardNames(after);
  return {
    removed: [...beforeNames].filter((name) => !afterNames.has(name)).sort(),
    added: [...afterNames].filter((name) => !beforeNames.has(name)).sort(),
  };
}

/**
 * Walks history backwards until the posture differs from the current one.
 *
 * Deliberately linear rather than a binary search. Binary search requires the
 * property to be monotonic, and posture is not: a route can go
 * `admin -> public -> admin -> public`, and bisecting that returns a commit
 * that is not the transition. Correctness outranks the scans saved.
 *
 * The scan stops at the first difference, so the common case — a change made
 * recently — costs a few scans rather than the whole limit.
 */
export function blame(
  root: string,
  route: string,
  scan: (dir: string) => ApplicationSecurityModel,
  currentModel: ApplicationSecurityModel,
  options: BlameOptions = {},
): BlameResult {
  const maxCommits = Math.max(1, options.maxCommits ?? DEFAULT_MAX_COMMITS);
  const current = postureIn(currentModel, route);

  const commits = listCommits(root, options.ref ?? "HEAD", {
    limit: maxCommits,
    ...(options.since ? { since: options.since } : {}),
    paths: RELEVANT_PATHS,
  });

  const incomplete = isShallow(root);

  if (commits.length === 0) {
    return { route, current, commitsScanned: 0, historyIncomplete: incomplete };
  }

  // `commits[0]` is HEAD, whose tree the working model normally matches. Walk
  // from the next one back, comparing each to the posture we started from.
  let scanned = 0;
  let newerCommit: CommitInfo = commits[0] as CommitInfo;

  for (let index = 1; index < commits.length; index += 1) {
    const commit = commits[index] as CommitInfo;
    const past = withTree(root, commit.sha, (dir) => postureIn(scan(dir), route));
    scanned += 1;

    if (past.posture !== current.posture) {
      // `newerCommit` is the first commit that already had the current posture:
      // the transition landed there.
      return {
        route,
        current,
        previous: past,
        transition: newerCommit,
        evidenceDiff: diffEvidence(past.evidence, current.evidence),
        commitsScanned: scanned,
        historyIncomplete: incomplete,
      };
    }
    newerCommit = commit;
  }

  return {
    route,
    current,
    commitsScanned: scanned,
    // Reaching the limit is itself incomplete history: a change may sit beyond it.
    historyIncomplete: incomplete || commits.length >= maxCommits,
  };
}
