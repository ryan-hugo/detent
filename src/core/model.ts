export type AccessLevel = "public" | "authenticated" | "admin" | "unknown";

/** Frameworks with an adapter. Widening this is an adapter decision, not a rule one. */
export type FrameworkName = "nextjs" | "sveltekit";

export type EntryPointKind = "route-handler" | "server-action";

export interface SourceLocation {
  file: string;
  line: number;
}

export interface AuthSignal {
  name: string;
  access: AccessLevel;
  location: SourceLocation;
  /**
   * Set when the signal comes from middleware matching this route rather than
   * from a call inside the handler.
   *
   * Kept distinct because the two are not equally strong: a guard in the body
   * runs for every caller, while middleware protection depends on a matcher
   * that a later edit can narrow without touching the route at all.
   */
  source?: "middleware";
  /**
   * Function names traversed from the entry point to reach this call, empty
   * when the call is written in the handler itself.
   *
   * This is the evidence behind an access level: a route can read as
   * `authenticated` because of a guard two calls away, and without the chain
   * there is no way to show why. The resolver already computes it; recording it
   * here is what makes the conclusion explainable rather than asserted.
   */
  via?: string[];
}

export interface SensitiveOperation {
  expression: string;
  category: "database-write" | "payment" | "filesystem" | "process" | "other";
  location: SourceLocation;
}

export interface ReachableCall {
  /** Callee text as written, e.g. `guards.requireAdmin`. */
  name: string;
  /**
   * Project-relative file whose body contains this call site.
   *
   * This is where the call is written, not where the callee is declared —
   * following a name to its declaration would need module resolution, which is
   * out of scope. It still gives a symbol a stable identity: two modules that
   * each call their own `requireUser` produce two distinct call sites.
   */
  callSite: string;
  /** 0 when written in the entry point itself, higher through helpers. */
  depth: number;
  /** Functions traversed from the entry point to reach it. */
  via: string[];
}

export interface EntryPoint {
  id: string;
  kind: EntryPointKind;
  method?: string;
  exportName: string;
  route?: string;
  location: SourceLocation;
  directives: string[];
  authSignals: AuthSignal[];
  inferredAccess: AccessLevel;
  sensitiveOperations: SensitiveOperation[];
  /**
   * Every callee reachable from this entry point, classified or not.
   * Vocabulary inference needs the unclassified ones: a project's own guard is
   * by definition a name the built-in detectors did not recognize.
   */
  reachableCalls?: string[];
  /**
   * The same reachable calls, qualified by the file whose body contained them
   * and by how far the resolver walked to get there.
   *
   * `reachableCalls` carries names only, which cannot distinguish two modules
   * that each export `requireUser`. Impact analysis has to tell them apart, so
   * it needs the file as well; the resolver already knew it.
   */
  reachable?: ReachableCall[];
}

/**
 * A request-level authorization barrier declared outside any entry point.
 *
 * Next.js middleware is the case this exists for: it guards by path match
 * rather than by being called, so the evidence lives in a different file from
 * the route it protects.
 */
export interface MiddlewareBarrier {
  /** Project-relative file the barrier is declared in. */
  file: string;
  /** Access level the guards inside its body establish. */
  access: AccessLevel;
  /** Guard calls found in the barrier body, as evidence. */
  guards: AuthSignal[];
  /** `config.matcher` sources exactly as written. */
  matchers: string[];
  /**
   * True when no `config.matcher` is exported.
   *
   * Next.js then runs the middleware on every request. This is a different
   * state from a matcher that happens to match everything, and worth keeping
   * distinct in output.
   */
  appliesToAll: boolean;
  /**
   * True when applicability cannot be decided from source — a dynamic matcher,
   * or one gated on `has`/`missing` request conditions.
   *
   * A conditional barrier is recorded but never raises a route's access level:
   * a guard we cannot prove applies is not evidence that it does.
   */
  conditional: boolean;
  location: SourceLocation;
}

export interface EnvironmentUsage {
  name: string;
  clientVisible: boolean;
  fileIsClient: boolean;
  location: SourceLocation;
}

export interface ClientBoundary {
  file: string;
  exportedNames: string[];
}

export interface Finding {
  id: string;
  ruleId: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  message: string;
  location: SourceLocation;
  evidence: Record<string, string | number | boolean>;
}

export interface ApplicationSecurityModel {
  schemaVersion: 1;
  generatedAt: string;
  root: string;
  framework: {
    name: FrameworkName;
    confidence: number;
  };
  entryPoints: EntryPoint[];
  /**
   * Request-level barriers declared outside any entry point.
   *
   * Next.js middleware (`proxy.ts` since v16) guards routes by path rather than
   * by being called from them, so it is a property of the application, not of
   * one handler. Recorded here and applied to the entry points it matches.
   */
  barriers?: MiddlewareBarrier[];
  /**
   * Files that did not parse cleanly, sorted.
   *
   * The scan still reports what it could read. A comparison between two states
   * needs this to tell an incomplete analysis from a real change.
   */
  unparsedFiles?: string[];
  clientBoundaries: ClientBoundary[];
  environment: EnvironmentUsage[];
  findings: Finding[];
}
