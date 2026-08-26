import type { SecurityChange } from "../core/diff.js";
import type { Breach } from "../core/contract.js";

/**
 * Markdown for pull-request surfaces.
 *
 * Written for `$GITHUB_STEP_SUMMARY`, which is a file the runner renders — no
 * API call, no token, no network. That keeps the local-first guarantee intact
 * while still putting the result where the reviewer already is.
 *
 * Presentation only. Nothing here decides whether a change is blocking.
 */

function escapePipes(value: string): string {
  // A route or identifier containing `|` would otherwise break the table.
  return value.replace(/\|/g, "\\|");
}

export function renderDiffMarkdown(changes: SecurityChange[], base?: string): string {
  const against = base ? ` against \`${escapePipes(base)}\`` : "";
  if (changes.length === 0) {
    return `### Security diff\n\nNothing moved${against}. The security model is unchanged.\n`;
  }

  const blocking = changes.filter(
    (change) => change.severity === "critical" || change.severity === "high",
  );

  const lines = [
    "### Security diff",
    "",
    blocking.length > 0
      ? `**${blocking.length} of ${changes.length} ${changes.length === 1 ? "change" : "changes"}${against} weakens the model.** This build fails.`
      : `${changes.length} ${changes.length === 1 ? "change" : "changes"}${against} recorded, none weakening.`,
    "",
    "| | Change | Detail |",
    "| --- | --- | --- |",
  ];

  for (const change of changes) {
    if (change.type === "access-broadened") {
      lines.push(
        `| 🔴 | access broadened | \`${escapePipes(change.id)}\` — \`${change.before}\` → \`${change.after}\` |`,
      );
    } else if (change.type === "client-secret-exposure-added") {
      lines.push(
        `| 🔴 | secret reaches client | \`${escapePipes(change.variable)}\` in \`${escapePipes(change.file)}\` |`,
      );
    } else {
      lines.push(
        `| ⚪ | entry point added | \`${escapePipes(change.entryPoint.id)}\` (\`${change.entryPoint.inferredAccess}\`) |`,
      );
    }
  }

  lines.push("");
  lines.push("<sub>Generated locally by detent. Target code was parsed, never executed.</sub>");
  return `${lines.join("\n")}\n`;
}

export function renderContractMarkdown(breaches: Breach[], required: number): string {
  if (breaches.length === 0) {
    return `### Security contract\n\nAll ${required} declared ${required === 1 ? "requirement holds" : "requirements hold"}.\n`;
  }

  const lines = [
    "### Security contract",
    "",
    `**${breaches.length} of ${required} declared ${required === 1 ? "requirement is" : "requirements are"} breached.**`,
    "",
    "| Requirement | Expected | Actual | Where |",
    "| --- | --- | --- | --- |",
  ];

  for (const breach of breaches) {
    lines.push(
      `| \`${escapePipes(breach.rule)}\` | ${escapePipes(breach.expectation)} | \`${escapePipes(breach.actual)}\` | \`${escapePipes(breach.location.file)}:${breach.location.line}\` |`,
    );
  }

  lines.push("");
  lines.push("<sub>Generated locally by detent. Target code was parsed, never executed.</sub>");
  return `${lines.join("\n")}\n`;
}
