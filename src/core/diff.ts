import { isBroader } from "./access.js";
import type { ApplicationSecurityModel, EntryPoint } from "./model.js";

export type SecurityChange =
  | { type: "entry-point-added"; severity: "info"; entryPoint: EntryPoint }
  | { type: "access-broadened"; severity: "high"; id: string; before: string; after: string }
  | { type: "client-secret-exposure-added"; severity: "critical"; variable: string; file: string };

export function diffModels(before: ApplicationSecurityModel, after: ApplicationSecurityModel): SecurityChange[] {
  const changes: SecurityChange[] = [];
  const beforeEntries = new Map(before.entryPoints.map((entry) => [entry.id, entry]));

  for (const entry of after.entryPoints) {
    const previous = beforeEntries.get(entry.id);
    if (!previous) {
      changes.push({ type: "entry-point-added", severity: "info", entryPoint: entry });
      continue;
    }
    if (isBroader(previous.inferredAccess, entry.inferredAccess)) {
      changes.push({
        type: "access-broadened",
        severity: "high",
        id: entry.id,
        before: previous.inferredAccess,
        after: entry.inferredAccess,
      });
    }
  }

  const beforeExposures = new Set(
    before.environment
      .filter((usage) => usage.clientVisible && /(SECRET|TOKEN|PASSWORD|PRIVATE_KEY|SERVICE_ROLE|API_KEY)/i.test(usage.name))
      .map((usage) => `${usage.name}:${usage.location.file}`),
  );

  for (const usage of after.environment) {
    const key = `${usage.name}:${usage.location.file}`;
    if (
      usage.clientVisible &&
      /(SECRET|TOKEN|PASSWORD|PRIVATE_KEY|SERVICE_ROLE|API_KEY)/i.test(usage.name) &&
      !beforeExposures.has(key)
    ) {
      changes.push({
        type: "client-secret-exposure-added",
        severity: "critical",
        variable: usage.name,
        file: usage.location.file,
      });
    }
  }

  return changes;
}
