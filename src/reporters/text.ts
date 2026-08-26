import type { ApplicationSecurityModel } from "../core/model.js";
import type { SecurityChange } from "../core/diff.js";
import type { Breach } from "../core/contract.js";
import type { EnrichedFinding } from "../core/enrich.js";
import type { EvidenceStep, Explanation } from "../core/explain.js";
import type { BlameResult } from "../core/blame.js";
import type { ImpactResult } from "../core/impact.js";
import type { ReviewResult } from "../core/review.js";

export function renderModel(model: ApplicationSecurityModel): string {
  const lines: string[] = [];
  lines.push("Application Security Model");
  lines.push("");
  lines.push(`Framework: ${model.framework.name} (${Math.round(model.framework.confidence * 100)}% confidence)`);
  lines.push(`Entry points: ${model.entryPoints.length}`);
  lines.push(`Client boundaries: ${model.clientBoundaries.length}`);
  lines.push(`Environment usages: ${model.environment.length}`);
  lines.push(`Findings: ${model.findings.length}`);
  lines.push("");

  for (const finding of model.findings) {
    lines.push(`${finding.severity.toUpperCase()} ${finding.ruleId} — ${finding.title}`);
    lines.push(`  ${finding.location.file}:${finding.location.line}`);
    lines.push(`  ${finding.message}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function renderDiff(changes: SecurityChange[]): string {
  if (changes.length === 0) return "Security Diff\n\nNo security-model changes detected.";
  const lines = ["Security Diff", ""];
  for (const change of changes) {
    if (change.type === "entry-point-added") {
      lines.push(`INFO entry point added — ${change.entryPoint.id} (${change.entryPoint.inferredAccess})`);
    } else if (change.type === "access-broadened") {
      lines.push(`HIGH access broadened — ${change.id}: ${change.before} -> ${change.after}`);
    } else {
      lines.push(`CRITICAL client secret exposure added — ${change.variable} in ${change.file}`);
    }
  }
  return lines.join("\n");
}

export function renderBreaches(breaches: Breach[]): string {
  if (breaches.length === 0) return "Security Contract\n\nAll requirements hold.";
  const lines = ["Security Contract", ""];
  for (const breach of breaches) {
    lines.push(`BREACH ${breach.rule}`);
    lines.push(`  ${breach.location.file}:${breach.location.line}`);
    lines.push(`  expected: ${breach.expectation}`);
    lines.push(`  actual:   ${breach.actual}`);
    lines.push(`  subject:  ${breach.subject}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function renderTriage(findings: EnrichedFinding[]): string {
  if (findings.length === 0) return "Triage\n\nNo external findings to triage.";

  const reachable = findings.filter((finding) => finding.priority === "critical").length;
  const lines = [
    "Triage",
    "",
    reachable > 0
      ? `${reachable} of ${findings.length} reachable from a public entry point.`
      : `${findings.length} findings, none reachable from a public entry point.`,
    "",
  ];

  for (const finding of findings) {
    lines.push(`${finding.priority.toUpperCase()} ${finding.ruleId}`);
    lines.push(`  ${finding.file}:${finding.line}`);
    lines.push(
      finding.reachedBy.length > 0
        ? `  reachable at: ${finding.reachableAt} via ${finding.reachedBy.length} entry ${finding.reachedBy.length === 1 ? "point" : "points"}`
        : `  not on any known entry-point path`,
    );
    if (finding.message) lines.push(`  ${finding.message}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function renderExplanations(explanations: Explanation[]): string {
  const lines: string[] = [];

  for (const item of explanations) {
    if (lines.length > 0) lines.push("");
    lines.push(`${item.method ?? item.kind} ${item.subject}`);
    lines.push(`  ${item.location.file}:${item.location.line}`);
    lines.push("");
    lines.push(`  Access: ${item.access}`);

    if (item.evidence.length === 0) {
      // Absence is the explanation here: nothing was found, and saying so is
      // more useful than an empty section.
      lines.push("  Evidence: none detected — this is why it reads as public");
    } else {
      lines.push("  Evidence:");
      for (const step of item.evidence) {
        // Render the walk from the handler inward, so the chain reads in the
        // order the code executes.
        const chain = [...step.via, step.call];
        chain.forEach((name, index) => {
          const indent = "    " + "  ".repeat(index);
          const arrow = index === 0 ? "" : "-> ";
          lines.push(`${indent}${arrow}${name}()`);
        });
        lines.push(`      establishes: ${step.access} (${step.location.file}:${step.location.line})`);
        // The guard is in another file and the handler shows no sign of it, so
        // say where the protection comes from rather than leaving the reader
        // hunting for a barrier that is not in the route.
        if (step.source === "middleware") {
          lines.push("      via middleware matching this route, not a call in the handler");
        }
      }
    }

    if (item.reaches.length > 0) {
      lines.push(`  Reaches: ${item.reaches.join(", ")}`);
    }
  }

  return lines.join("\n");
}

function renderChain(evidence: EvidenceStep[], indent: string): string[] {
  if (evidence.length === 0) return [`${indent}none detected`];
  const lines: string[] = [];
  for (const step of evidence) {
    [...step.via, step.call].forEach((name, index) => {
      lines.push(`${indent}${"  ".repeat(index)}${index === 0 ? "" : "-> "}${name}()`);
    });
  }
  return lines;
}

export function renderBlame(result: BlameResult): string {
  const lines = [`Route: ${result.route}`, ""];
  lines.push(
    result.current.posture === "absent"
      ? "  Current: not present in the working tree"
      : `  Current access: ${result.current.posture}`,
  );

  if (!result.transition || !result.previous) {
    lines.push("");
    lines.push(
      result.commitsScanned === 0
        ? "  No prior commits touched this project, so there is nothing to compare against."
        : `  No posture change found in the ${result.commitsScanned} commits examined.`,
    );
    if (result.historyIncomplete) {
      // Absence of evidence is not evidence of absence, and a shallow clone or
      // a reached limit is exactly that.
      lines.push("  History is incomplete, so this does not mean the route never changed.");
    }
    return lines.join("\n");
  }

  const from = result.previous.posture;
  const to = result.current.posture;
  lines.push("");
  lines.push(`  Posture changed: ${from} -> ${to}`);
  lines.push("");
  // Stated as "changed in", never "caused by": the evidence shows the state
  // differs across this commit, not that someone intended the change.
  lines.push(`  Changed in: ${result.transition.sha.slice(0, 8)}  ${result.transition.date.slice(0, 10)}`);
  lines.push(`    ${result.transition.author}  ${result.transition.subject}`);

  lines.push("");
  lines.push("  Evidence before:");
  lines.push(...renderChain(result.previous.evidence, "    "));
  lines.push("");
  lines.push("  Evidence after:");
  lines.push(...renderChain(result.current.evidence, "    "));

  const diff = result.evidenceDiff;
  if (diff && (diff.removed.length > 0 || diff.added.length > 0)) {
    lines.push("");
    if (diff.removed.length > 0) lines.push(`  Removed: ${diff.removed.join(", ")}`);
    if (diff.added.length > 0) lines.push(`  Added: ${diff.added.join(", ")}`);
  }

  if (result.historyIncomplete) {
    lines.push("");
    lines.push("  History is incomplete; earlier changes may exist beyond what was examined.");
  }
  return lines.join("\n");
}

export function renderImpact(result: ImpactResult): string {
  const lines = [`Symbol: ${result.symbol.name}`, ""];

  if (result.reachableCount === 0) {
    lines.push("  No entry point reaches this symbol.");
    return lines.join("\n");
  }

  lines.push(`  Reached by: ${result.reachableCount} ${result.reachableCount === 1 ? "entry point" : "entry points"}`);
  // Reaching a guard and being guarded by it are different claims, and the
  // model can tell them apart, so they are reported separately.
  lines.push(`  Security evidence for: ${result.securityEvidenceCount}`);

  const distribution = Object.entries(result.accessDistribution)
    .filter(([, count]) => count > 0)
    .map(([level, count]) => `${level} ${count}`)
    .join("   ");
  if (distribution) {
    lines.push("");
    lines.push(`  Access: ${distribution}`);
  }

  lines.push("");
  for (const item of result.entryPoints) {
    lines.push(`  ${item.subject}`);
    const flags: string[] = [item.access, item.relationship];
    if (item.securityEvidence) flags.push("security evidence");
    lines.push(`    ${flags.join("  ")}`);
    if (item.via.length > 0) {
      lines.push(`    via ${[...item.via, result.symbol.name].join(" -> ")}`);
    }
  }
  return lines.join("\n");
}

const CHANGE_LABEL: Record<string, string> = {
  regression: "regression",
  improvement: "improvement",
  "added-surface": "new public surface",
  "added-protected-surface": "new protected surface",
  "removed-surface": "surface removed",
  "evidence-only": "evidence changed",
};

export function renderReview(result: ReviewResult, base: string): string {
  const lines = ["Security review", "", `  Compared against ${base}`, ""];

  if (result.unparsedFiles.length > 0) {
    // Said first, because it changes how everything below should be read: a
    // route missing from a file that did not parse looks exactly like one that
    // was deleted.
    lines.push(`  ${result.unparsedFiles.length} file(s) did not parse, so this analysis is incomplete:`);
    for (const file of result.unparsedFiles.slice(0, 5)) lines.push(`    ${file}`);
    lines.push("");
  }

  if (result.postureChanges.length === 0 && result.evidenceChanges.length === 0) {
    lines.push(
      result.unparsedFiles.length > 0
        ? "  No security posture changes found in what could be parsed."
        : "  No security posture changes detected.",
    );
    return lines.join("\n");
  }

  lines.push(
    `  Posture changes: ${result.postureChanges.length}` +
      (result.regressionCount > 0 ? `  (${result.regressionCount} weakening)` : ""),
  );
  lines.push(`  Evidence changes without posture change: ${result.evidenceChanges.length}`);

  for (const change of result.postureChanges) {
    lines.push("");
    lines.push(`  ${change.subject}`);
    lines.push(`    ${CHANGE_LABEL[change.kind] ?? change.kind}: ${change.before} -> ${change.after}`);
    if (change.evidenceRemoved.length > 0) lines.push(`    removed: ${change.evidenceRemoved.join(", ")}`);
    if (change.evidenceAdded.length > 0) lines.push(`    added: ${change.evidenceAdded.join(", ")}`);
  }

  for (const change of result.evidenceChanges) {
    lines.push("");
    lines.push(`  ${change.subject}`);
    // Said plainly: the guard changed, the answer did not.
    lines.push(`    evidence changed, posture unchanged (${change.after})`);
    if (change.evidenceRemoved.length > 0) lines.push(`    removed: ${change.evidenceRemoved.join(", ")}`);
    if (change.evidenceAdded.length > 0) lines.push(`    added: ${change.evidenceAdded.join(", ")}`);
  }

  if (result.dependencies.length > 0) {
    lines.push("");
    lines.push("  Depends on the symbols that changed:");
    for (const dependency of result.dependencies) {
      lines.push(
        `    ${dependency.symbol}: reached by ${dependency.reachableCount}, ` +
          `security evidence for ${dependency.securityEvidenceCount}`,
      );
    }
    // The counts above are dependency, not consequence. Only the posture
    // changes listed earlier are proven to have moved.
    lines.push("");
    lines.push(
      `  Dependency is not consequence: ${result.postureChanges.length} ` +
        `${result.postureChanges.length === 1 ? "posture" : "postures"} actually changed.`,
    );
  }

  return lines.join("\n");
}
