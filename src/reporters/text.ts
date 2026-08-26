import type { ApplicationSecurityModel } from "../core/model.js";
import type { SecurityChange } from "../core/diff.js";
import type { Breach } from "../core/contract.js";
import type { EnrichedFinding } from "../core/enrich.js";
import type { EvidenceStep, Explanation } from "../core/explain.js";
import type { BlameResult } from "../core/blame.js";
import type { ImpactResult } from "../core/impact.js";

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
