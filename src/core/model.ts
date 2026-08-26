export type AccessLevel = "public" | "authenticated" | "admin" | "unknown";

export type EntryPointKind = "route-handler" | "server-action";

export interface SourceLocation {
  file: string;
  line: number;
}

export interface AuthSignal {
  name: string;
  access: AccessLevel;
  location: SourceLocation;
}

export interface SensitiveOperation {
  expression: string;
  category: "database-write" | "payment" | "filesystem" | "process" | "other";
  location: SourceLocation;
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
    name: "nextjs";
    confidence: number;
  };
  entryPoints: EntryPoint[];
  clientBoundaries: ClientBoundary[];
  environment: EnvironmentUsage[];
  findings: Finding[];
}
