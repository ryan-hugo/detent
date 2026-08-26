import type { AccessLevel, AuthSignal } from "./model.js";

const rank: Record<AccessLevel, number> = {
  public: 0,
  unknown: 1,
  authenticated: 2,
  admin: 3,
};

export function inferAccess(signals: AuthSignal[]): AccessLevel {
  if (signals.some((signal) => signal.access === "admin")) return "admin";
  if (signals.some((signal) => signal.access === "authenticated")) return "authenticated";
  return "public";
}

export function isBroader(before: AccessLevel, after: AccessLevel): boolean {
  return rank[after] < rank[before];
}
