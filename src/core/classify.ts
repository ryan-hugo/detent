import type { AccessLevel, SensitiveOperation } from "./model.js";
import type { DetentConfig } from "./config.js";

/**
 * Framework-agnostic classification of call names.
 *
 * This lives in core, not in an adapter: what makes a call an authorization
 * barrier or a sensitive operation is a property of the security model, not of
 * Next.js. Adapters decide *which* calls are reachable from an entry point;
 * this decides what those calls mean.
 */

/** Last segment of a dotted callee, so `guards.requireAdmin` matches `requireAdmin`. */
export function baseName(name: string): string {
  const parts = name.split(".");
  return parts[parts.length - 1] ?? name;
}

/** Splits an identifier into lowercase words: `requireAdmin` -> ["require","admin"]. */
function words(name: string): string[] {
  return baseName(name)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

export function classifyAuth(name: string, config: DetentConfig): AccessLevel | undefined {
  // An explicit denial always wins, including over the built-in detectors.
  if (config.notGuards.includes(name) || config.notGuards.includes(baseName(name))) {
    return undefined;
  }
  // An explicit mapping is stronger evidence than a name heuristic.
  const configured = config.guards[name] ?? config.guards[baseName(name)];
  if (configured) return configured;

  // Cryptographic verification is authentication, and stronger than a session
  // lookup. Stripe's constructEvent throws on a bad signature; a timing-safe
  // comparison guards a shared secret. Missing these reported real webhooks —
  // shadcn-ui/taxonomy's Stripe handler among them — as unprotected.
  if (/\b(constructEvent|verifySignature|verifyWebhook|timingSafeEqual|createHmac|verifyKey)\b/.test(name)) {
    return "authenticated";
  }

  // Match whole words, not substrings. Real code is full of names that merely
  // contain these letters — `oAuthAppSchema.parse` is a Zod validator and
  // `stripe.billingPortal.sessions.create` opens a payment session; neither is
  // an authorization barrier, and believing them repeats the dead-text bug.
  const parts = words(name);
  if (parts.includes("admin")) return "admin";
  if (parts.some((word) => ["auth", "authenticate", "authorize", "session", "protect"].includes(word))) {
    return "authenticated";
  }
  if (/\b(current|require|get|ensure) user\b/.test(parts.join(" "))) return "authenticated";
  return undefined;
}

export function classifySensitive(
  name: string,
  config: DetentConfig,
): SensitiveOperation["category"] | undefined {
  const configured = config.sensitive[name] ?? config.sensitive[baseName(name)];
  if (configured) return configured;

  if (/stripe\.(refunds|paymentIntents|charges)\./i.test(name)) return "payment";
  if (
    /\.(create|update|delete|upsert|execute|executeRaw)$/i.test(name) &&
    /(db|prisma|database|repo|repository)/i.test(name)
  ) {
    return "database-write";
  }
  if (/^(fs\.|.*\.writeFile|.*\.rm|.*\.unlink)/i.test(name)) return "filesystem";
  if (/(exec|spawn|execFile)$/i.test(name)) return "process";
  return undefined;
}
