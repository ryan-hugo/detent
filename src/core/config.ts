import type { AccessLevel, SensitiveOperation } from "./model.js";

/**
 * Project-local vocabulary.
 *
 * The built-in detectors recognize common English guard names. Real codebases
 * name things their own way, in their own language, which produces errors in
 * both directions: a real guard read as `public`, or an unrelated function whose
 * name merely contains "admin" read as an authorization barrier.
 *
 * This file is data, never code. It is parsed as JSON and never imported or
 * evaluated, so loading a config cannot execute anything from the target repo.
 */

export interface DetentConfig {
  /** Exact callee names that establish an access level, e.g. `exigirGestor`. */
  guards: Record<string, AccessLevel>;
  /** Exact callee names that must never count as guards, even if built-ins match. */
  notGuards: string[];
  /** Exact callee names that perform a sensitive operation. */
  sensitive: Record<string, SensitiveOperation["category"]>;
}

/**
 * Lookup tables must not inherit from Object.prototype.
 *
 * A callee named `toString`, `constructor` or `valueOf` is ordinary in real code
 * (`searchParams.toString()`), and a plain `{}` would resolve those to inherited
 * members — handing back a function where an access level was expected, which
 * then reads as truthy evidence of an authorization barrier.
 */
function bare<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

export const EMPTY_CONFIG: DetentConfig = {
  guards: bare<AccessLevel>(),
  notGuards: [],
  sensitive: bare<SensitiveOperation["category"]>(),
};

const ACCESS_LEVELS = new Set<string>(["public", "authenticated", "admin", "unknown"]);
const CATEGORIES = new Set<string>(["database-write", "payment", "filesystem", "process", "other"]);

export class ConfigError extends Error {}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConfigError(`"${field}" must be an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * Validates untrusted JSON into a config. Rejects unknown access levels and
 * categories rather than silently ignoring them: a typo in a guard mapping
 * would otherwise read as "no guard", which is exactly the wrong default.
 */
export function parseConfig(raw: unknown): DetentConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ConfigError("config must be a JSON object");
  }
  const source = raw as Record<string, unknown>;

  const guards = bare<AccessLevel>();
  for (const [name, level] of Object.entries(asRecord(source["guards"], "guards"))) {
    if (typeof level !== "string" || !ACCESS_LEVELS.has(level)) {
      throw new ConfigError(
        `guard "${name}" maps to ${JSON.stringify(level)}; expected one of ${[...ACCESS_LEVELS].join(", ")}`,
      );
    }
    guards[name] = level as AccessLevel;
  }

  const sensitive = bare<SensitiveOperation["category"]>();
  for (const [name, category] of Object.entries(asRecord(source["sensitive"], "sensitive"))) {
    if (typeof category !== "string" || !CATEGORIES.has(category)) {
      throw new ConfigError(
        `sensitive "${name}" maps to ${JSON.stringify(category)}; expected one of ${[...CATEGORIES].join(", ")}`,
      );
    }
    sensitive[name] = category as SensitiveOperation["category"];
  }

  const rawNotGuards = source["notGuards"] ?? [];
  if (!Array.isArray(rawNotGuards)) throw new ConfigError(`"notGuards" must be an array`);
  const notGuards = rawNotGuards.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new ConfigError(`notGuards[${index}] must be a string`);
    }
    return entry;
  });

  return { guards, notGuards, sensitive };
}

/** Config file name looked up at the project root. */
export const CONFIG_FILENAME = "detent.config.json";
