import type { AccessLevel, ApplicationSecurityModel, SourceLocation } from "./model.js";

/**
 * Security Contract v0.
 *
 * A finding says "this looks wrong". A contract says "this must hold". The
 * difference matters: a rule is the tool's opinion and can be argued with, an
 * invariant is the team's decision and a breach is unambiguous.
 *
 * Contracts are declared as data in `detent.contract.json` and never executed.
 */

export type Requirement =
  /** An entry point must sit at or above an access level. */
  | { rule: "entry-point-requires-access"; match: string; access: AccessLevel }
  /** An environment variable must never be readable by the client. */
  | { rule: "env-is-server-only"; name: string }
  /** Any entry point performing this operation category must carry a guard. */
  | { rule: "sensitive-operation-requires-guard"; category: string }
  /** Every entry point matching the pattern must sit at the same access level. */
  | { rule: "siblings-agree-on-access"; match: string }
  /** No entry point matching the pattern may be public. */
  | { rule: "no-public-entry-point"; match: string };

export interface SecurityContract {
  requirements: Requirement[];
}

export const EMPTY_CONTRACT: SecurityContract = { requirements: [] };

export interface Breach {
  rule: Requirement["rule"];
  /** What the contract demanded, in the team's own words. */
  expectation: string;
  /** What the model actually shows. */
  actual: string;
  subject: string;
  location: SourceLocation;
}

export class ContractError extends Error {}

const ACCESS_RANK: Record<AccessLevel, number> = {
  public: 0,
  unknown: 1,
  authenticated: 2,
  admin: 3,
};

const ACCESS_LEVELS = new Set<string>(Object.keys(ACCESS_RANK));

export const CONTRACT_FILENAME = "detent.contract.json";

function requireString(value: unknown, field: string, index: number): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ContractError(`requirements[${index}].${field} must be a non-empty string`);
  }
  return value;
}

export function parseContract(raw: unknown): SecurityContract {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ContractError("contract must be a JSON object");
  }
  const list = (raw as Record<string, unknown>)["requirements"] ?? [];
  if (!Array.isArray(list)) throw new ContractError(`"requirements" must be an array`);

  return {
    requirements: list.map((entry, index) => {
      if (typeof entry !== "object" || entry === null) {
        throw new ContractError(`requirements[${index}] must be an object`);
      }
      const item = entry as Record<string, unknown>;
      const rule = requireString(item["rule"], "rule", index);

      if (rule === "entry-point-requires-access") {
        const access = requireString(item["access"], "access", index);
        if (!ACCESS_LEVELS.has(access)) {
          throw new ContractError(
            `requirements[${index}].access is ${JSON.stringify(access)}; expected one of ${[...ACCESS_LEVELS].join(", ")}`,
          );
        }
        return {
          rule,
          match: requireString(item["match"], "match", index),
          access: access as AccessLevel,
        };
      }
      if (rule === "env-is-server-only") {
        return { rule, name: requireString(item["name"], "name", index) };
      }
      if (rule === "sensitive-operation-requires-guard") {
        return { rule, category: requireString(item["category"], "category", index) };
      }
      if (rule === "siblings-agree-on-access" || rule === "no-public-entry-point") {
        return { rule, match: requireString(item["match"], "match", index) };
      }
      throw new ContractError(
        `requirements[${index}].rule is ${JSON.stringify(rule)}; expected one of ` +
          `entry-point-requires-access, env-is-server-only, sensitive-operation-requires-guard, ` +
          `siblings-agree-on-access, no-public-entry-point`,
      );
    }),
  };
}

/**
 * Glob-ish matching for route and export identifiers. Supports `*` only, which
 * covers `/api/admin/*` without pulling in a regex dialect users must learn.
 */
function matches(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(value);
}

export function checkContract(
  contract: SecurityContract,
  model: ApplicationSecurityModel,
): Breach[] {
  const breaches: Breach[] = [];

  for (const requirement of contract.requirements) {
    if (requirement.rule === "entry-point-requires-access") {
      const required = ACCESS_RANK[requirement.access];
      for (const entry of model.entryPoints) {
        const subject = entry.route ?? entry.exportName;
        if (!matches(requirement.match, subject)) continue;
        if (ACCESS_RANK[entry.inferredAccess] < required) {
          breaches.push({
            rule: requirement.rule,
            expectation: `${requirement.match} requires ${requirement.access}`,
            actual: entry.inferredAccess,
            subject: entry.id,
            location: entry.location,
          });
        }
      }
      continue;
    }

    if (requirement.rule === "env-is-server-only") {
      for (const usage of model.environment) {
        if (usage.name !== requirement.name) continue;
        if (usage.clientVisible || usage.fileIsClient) {
          breaches.push({
            rule: requirement.rule,
            expectation: `${requirement.name} must stay server-only`,
            actual: usage.clientVisible
              ? "exposed through a NEXT_PUBLIC_ prefix"
              : "read inside a 'use client' module",
            subject: usage.name,
            location: usage.location,
          });
        }
      }
      continue;
    }

    if (requirement.rule === "sensitive-operation-requires-guard") {
      for (const entry of model.entryPoints) {
        const performs = entry.sensitiveOperations.filter(
          (operation) => operation.category === requirement.category,
        );
        if (performs.length === 0 || entry.authSignals.length > 0) continue;
        breaches.push({
          rule: requirement.rule,
          expectation: `${requirement.category} requires a guard`,
          actual: "no authorization signal detected",
          subject: entry.id,
          location: performs[0]?.location ?? entry.location,
        });
      }
      continue;
    }

    if (requirement.rule === "no-public-entry-point") {
      // Catches the case an access-level requirement misses: a route that did
      // not exist when the contract was written cannot be listed by name.
      for (const entry of model.entryPoints) {
        const subject = entry.route ?? entry.exportName;
        if (!matches(requirement.match, subject)) continue;
        if (entry.inferredAccess === "public") {
          breaches.push({
            rule: requirement.rule,
            expectation: `nothing under ${requirement.match} may be public`,
            actual: "public",
            subject: entry.id,
            location: entry.location,
          });
        }
      }
      continue;
    }

    // siblings-agree-on-access: an inconsistent group is the shape of a route
    // someone forgot to protect, and it needs no per-route declaration.
    const group = model.entryPoints.filter((entry) =>
      matches(requirement.match, entry.route ?? entry.exportName),
    );
    if (group.length < 2) continue;

    const strongest = group.reduce((best, entry) =>
      ACCESS_RANK[entry.inferredAccess] > ACCESS_RANK[best.inferredAccess] ? entry : best,
    );
    for (const entry of group) {
      if (entry.inferredAccess === strongest.inferredAccess) continue;
      breaches.push({
        rule: requirement.rule,
        expectation: `${requirement.match} must agree on access; its strongest is ${strongest.inferredAccess}`,
        actual: entry.inferredAccess,
        subject: entry.id,
        location: entry.location,
      });
    }
  }

  return breaches;
}
