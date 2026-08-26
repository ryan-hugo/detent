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
