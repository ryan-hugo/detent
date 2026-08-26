import type { AccessLevel, ApplicationSecurityModel, EntryPoint } from "./model.js";

/**
 * Answers "which entry points reach this symbol".
 *
 * Derived entirely from `reachable`, which the scanner already recorded. There
 * is no second traversal and no second source of truth: this inverts an
 * existing relation rather than recomputing it.
 *
 * The distinction the output rests on:
 *
 * - **reachable** — the resolver walked from the entry point to this symbol.
 *   Provable from the model.
 * - **security evidence** — this symbol is one the classifier actually used to
 *   decide the entry point's access level. Also provable: `authSignals` records
 *   which calls established the level, and `via` records how they were reached.
 *
 * Reaching a guard is not the same as being guarded by it, and the model can
 * tell those apart, so the output does.
 */

export class ImpactError extends Error {}

export interface SymbolRef {
  name: string;
  /**
   * Call sites this symbol was seen at, sorted.
   *
   * A symbol is identified by name plus where it is called from. One helper
   * called by three routes has three call sites and is still one symbol; two
   * modules that each declare their own `requireUser` are two symbols only when
   * the model can show they resolve differently. Where it cannot, the caller is
   * asked to disambiguate rather than being given a merged answer.
   */
  callSites: string[];
}

export interface ImpactedEntryPoint {
  entryPointId: string;
  /** Route when the framework has one, otherwise the exported name. */
  subject: string;
  access: AccessLevel;
  /** `direct` when written in the entry point, `transitive` when through helpers. */
  relationship: "direct" | "transitive";
  /** Functions traversed to reach the symbol. Empty for a direct call. */
  via: string[];
  /** True when this symbol established the entry point's access level. */
  securityEvidence: boolean;
}

export interface ImpactResult {
  symbol: SymbolRef;
  entryPoints: ImpactedEntryPoint[];
  /** Entry points that reach the symbol at all. */
  reachableCount: number;
  /** Entry points whose access level this symbol helped decide. */
  securityEvidenceCount: number;
  /** Access levels across the reaching entry points. */
  accessDistribution: Record<AccessLevel, number>;
}

/** Last segment of a dotted callee: `guards.requireAdmin` → `requireAdmin`. */
function baseName(name: string): string {
  const parts = name.split(".");
  return parts[parts.length - 1] ?? name;
}

/** Every symbol name the model saw, for a helpful error. */
export function knownSymbols(model: ApplicationSecurityModel): string[] {
  const out = new Set<string>();
  for (const entry of model.entryPoints) {
    for (const call of entry.reachable ?? []) out.add(call.name);
  }
  return [...out].sort();
}

/**
 * Symbols matching a query.
 *
 * Grouped by name: one helper called from many places is one symbol. A bare
 * name is ambiguous only when the model shows the same name resolving to
 * different behaviour — different files reached beneath it — and then the
 * caller is asked to choose instead of being handed a merged answer.
 *
 *  selects the symbol as called from that file.
 */
export function findSymbols(model: ApplicationSecurityModel, query: string): SymbolRef[] {
  const wanted = query.trim();
  if (wanted.length === 0) return [];

  const hash = wanted.indexOf('#');
  const qualifiedFile = hash >= 0 ? wanted.slice(0, hash) : undefined;
  const qualifiedName = hash >= 0 ? wanted.slice(hash + 1) : undefined;
  const targetName = qualifiedName ?? wanted;

  const sites = new Set<string>();
  for (const entry of model.entryPoints) {
    for (const call of entry.reachable ?? []) {
      if (call.name !== targetName && baseName(call.name) !== targetName) continue;
      if (qualifiedFile !== undefined && call.callSite !== qualifiedFile) continue;
      sites.add(call.callSite);
    }
  }
  if (sites.size === 0) return [];
  return [{ name: targetName, callSites: [...sites].sort() }];
}

/**
 * True when `symbol` is one the classifier used to decide this entry point's
 * access level.
 *
 * An authorization signal records the call that established the level and the
 * chain that reached it. A symbol counts as evidence when it is that call, or a
 * hop on the way to it — both are things the conclusion depended on. A symbol
 * merely reachable from the entry point is not evidence, which is the whole
 * point of reporting the two counts separately.
 */
function isSecurityEvidence(entry: EntryPoint, symbol: SymbolRef): boolean {
  const target = baseName(symbol.name);
  return entry.authSignals.some(
    (signal) =>
      baseName(signal.name) === target || (signal.via ?? []).some((hop) => baseName(hop) === target),
  );
}

const RELATIONSHIP_ORDER = { direct: 0, transitive: 1 } as const;

export function impact(model: ApplicationSecurityModel, symbol: SymbolRef): ImpactResult {
  const impacted: ImpactedEntryPoint[] = [];
  const accessDistribution: Record<AccessLevel, number> = {
    public: 0,
    unknown: 0,
    authenticated: 0,
    admin: 0,
  };

  for (const entry of model.entryPoints) {
    // Shallowest match: the most direct way this entry point reaches it.
    const reaching = (entry.reachable ?? [])
      .filter(
        (item) =>
          (item.name === symbol.name || baseName(item.name) === symbol.name) &&
          symbol.callSites.includes(item.callSite),
      )
      .sort((a, b) => a.depth - b.depth);
    const call = reaching[0];
    if (!call) continue;

    // Each entry point is counted once, however many paths reach the symbol.
    accessDistribution[entry.inferredAccess] += 1;
    impacted.push({
      entryPointId: entry.id,
      subject: entry.route ?? entry.exportName,
      access: entry.inferredAccess,
      relationship: call.depth === 0 ? "direct" : "transitive",
      via: call.via,
      securityEvidence: isSecurityEvidence(entry, symbol),
    });
  }

  // Evidence first, then direct before transitive, then by name. Deterministic
  // and independent of map or filesystem ordering.
  impacted.sort(
    (a, b) =>
      Number(b.securityEvidence) - Number(a.securityEvidence) ||
      RELATIONSHIP_ORDER[a.relationship] - RELATIONSHIP_ORDER[b.relationship] ||
      a.subject.localeCompare(b.subject) ||
      a.entryPointId.localeCompare(b.entryPointId),
  );

  return {
    symbol,
    entryPoints: impacted,
    reachableCount: impacted.length,
    securityEvidenceCount: impacted.filter((item) => item.securityEvidence).length,
    accessDistribution,
  };
}
