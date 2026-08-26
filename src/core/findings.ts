import type { ApplicationSecurityModel, Finding } from "./model.js";

function findingId(ruleId: string, file: string, line: number): string {
  return `${ruleId}:${file}:${line}`;
}

export function deriveFindings(model: Omit<ApplicationSecurityModel, "findings">): Finding[] {
  const findings: Finding[] = [];

  for (const entry of model.entryPoints) {
    const mutatingMethod = entry.method && ["POST", "PUT", "PATCH", "DELETE"].includes(entry.method);
    const sensitive = entry.sensitiveOperations.length > 0;

    // Only report when a sensitive operation was actually observed.
    //
    // Reporting every unguarded server action instead was the tool's own words
    // over evidence: on vercel/commerce it fired on all six entry points, and
    // all six were anonymous cart operations that need no session. The narrower
    // rule loses nothing on the fixtures — every true positive there carries an
    // observed operation — and the "mutating but nothing recognized" case is
    // exactly where `unknown` beats a fabricated finding.
    if (sensitive && entry.inferredAccess === "public") {
      const ruleId = "AUTH001";
      findings.push({
        id: findingId(ruleId, entry.location.file, entry.location.line),
        ruleId,
        severity: mutatingMethod || entry.kind === "server-action" ? "high" : "medium",
        title: "Sensitive entry point has no detected authorization barrier",
        message: `${entry.id} performs a mutation or sensitive operation but no configured authentication signal was detected.`,
        location: entry.location,
        evidence: {
          entryPoint: entry.id,
          sensitiveOperations: entry.sensitiveOperations.length,
          inferredAccess: entry.inferredAccess,
        },
      });
    }

    // A guard that runs after the operation it is supposed to protect is not a
    // barrier. Position is real evidence, not a heuristic: every authorization
    // signal sits below every sensitive operation in the same function body.
    if (entry.authSignals.length > 0 && entry.sensitiveOperations.length > 0) {
      const firstSensitive = Math.min(...entry.sensitiveOperations.map((op) => op.location.line));
      const earliestGuard = Math.min(...entry.authSignals.map((signal) => signal.location.line));
      if (earliestGuard > firstSensitive) {
        const ruleId = "AUTH003";
        findings.push({
          id: findingId(ruleId, entry.location.file, earliestGuard),
          ruleId,
          severity: "high",
          title: "Authorization runs after the operation it should protect",
          message: `${entry.id} performs a sensitive operation on line ${firstSensitive} but the first authorization signal appears on line ${earliestGuard}.`,
          location: { file: entry.location.file, line: earliestGuard },
          evidence: {
            entryPoint: entry.id,
            sensitiveOperationLine: firstSensitive,
            firstGuardLine: earliestGuard,
          },
        });
      }
    }

    if (entry.route?.includes("/admin") && entry.inferredAccess !== "admin") {
      const ruleId = "AUTH002";
      findings.push({
        id: findingId(ruleId, entry.location.file, entry.location.line),
        ruleId,
        severity: "high",
        title: "Admin route is not protected by an admin authorization signal",
        message: `${entry.route} is under an admin path but the strongest detected access level is ${entry.inferredAccess}.`,
        location: entry.location,
        evidence: { route: entry.route, inferredAccess: entry.inferredAccess },
      });
    }
  }

  for (const usage of model.environment) {
    const looksSecret = /(SECRET|TOKEN|PASSWORD|PRIVATE_KEY|SERVICE_ROLE|API_KEY)/i.test(usage.name);
    if (usage.clientVisible && looksSecret) {
      const ruleId = "ENV001";
      findings.push({
        id: findingId(ruleId, usage.location.file, usage.location.line),
        ruleId,
        severity: "critical",
        title: "Sensitive-looking environment variable is explicitly client-visible",
        message: `${usage.name} uses a public client prefix and appears to contain secret material.`,
        location: usage.location,
        evidence: { variable: usage.name, clientVisible: true },
      });
    } else if (usage.fileIsClient && !usage.clientVisible) {
      const ruleId = "ENV002";
      findings.push({
        id: findingId(ruleId, usage.location.file, usage.location.line),
        ruleId,
        severity: "high",
        title: "Server-scoped environment variable referenced from a client module",
        message: `${usage.name} is referenced inside a 'use client' module but is not explicitly client-visible.`,
        location: usage.location,
        evidence: { variable: usage.name, clientVisible: false },
      });
    }
  }

  return findings;
}
