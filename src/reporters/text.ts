import type { ApplicationSecurityModel } from "../core/model.js";
import type { SecurityChange } from "../core/diff.js";
import type { Breach } from "../core/contract.js";
import type { EnrichedFinding } from "../core/enrich.js";

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
