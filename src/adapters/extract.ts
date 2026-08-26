import ts from "typescript";

/**
 * Syntactic extraction over the TypeScript AST.
 *
 * This module replaces the lexical scanning that produced the gaps recorded in
 * docs/roadmap/phase-0.md. Only the parser is used — no type checker, no module
 * resolution, no program construction — so target code is still never executed
 * and no import is ever followed.
 */

export interface ExtractedCall {
  /** Dotted callee text, e.g. `stripe.refunds.create`. */
  name: string;
  line: number;
}

export interface ExtractedFunction {
  name: string;
  line: number;
  /** True when the function body opens with its own `use server` directive. */
  isInlineServerAction: boolean;
  calls: ExtractedCall[];
}

export interface ImportBinding {
  /** Local name used in this file. */
  local: string;
  /** Module specifier exactly as written, e.g. `@/lib/guard`. */
  from: string;
  /** Line the import appears on, so an env read can point at real evidence. */
  line: number;
}

/**
 * `export const config = { matcher: … }` as written in a middleware file.
 *
 * Next.js requires these to be static constants so it can read them at build
 * time; a value built from a variable is ignored by the framework itself. This
 * mirrors that rule — only literals are collected, and anything dynamic is
 * reported through `hasDynamicMatcher` rather than guessed at.
 */
export interface ExtractedRouteConfig {
  /** Literal `matcher` sources, whether given as a string or an array. */
  matchers: string[];
  /** True when a `matcher` entry was present but not a static literal. */
  hasDynamicMatcher: boolean;
  /** True when any matcher object carries `has`/`missing` request conditions. */
  hasRequestConditions: boolean;
  line: number;
}

export interface ExtractedModule {
  /** Directives that apply to the whole module (top of file only). */
  moduleDirectives: string[];
  functions: ExtractedFunction[];
  /** `export const config = {…}`, when the module declares one. */
  routeConfig?: ExtractedRouteConfig;
  /** `process.env.X` reads anywhere in the file. */
  envReads: { name: string; line: number }[];
  /** Every function declared here, exported or not, so calls can be resolved. */
  localFunctions: Map<string, ExtractedFunction>;
  /** Imported names, so a call can be traced to the file that defines it. */
  imports: ImportBinding[];
  /**
   * True when the file did not parse cleanly.
   *
   * The parser recovers and returns a partial tree, which is right for a
   * scanner — half a file still yields real findings. But a caller comparing
   * two states has to know, because a route missing from a broken file looks
   * exactly like a route that was deleted.
   */
  hasSyntaxErrors: boolean;
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/** Reads leading string-literal directives from a statement list. */
function directivesOf(statements: ts.NodeArray<ts.Statement>): string[] {
  const found: string[] = [];
  for (const statement of statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isStringLiteralLike(statement.expression)
    ) {
      break; // directive prologue ends at the first non-string statement
    }
    found.push(statement.expression.text);
  }
  return found;
}

/** Flattens `a.b.c` into dotted text. Returns undefined for computed access. */
function calleeName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    const left = calleeName(expression.expression);
    return left ? `${left}.${expression.name.text}` : undefined;
  }
  return undefined;
}

/** The function-like node behind an exported binding, if there is one. */
function functionOf(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  if (ts.isFunctionDeclaration(node)) return node;
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return node;
  // `export const POST = (async () => {…})` — grouping parens around the
  // handler, which real code produces when a wrapper is removed by hand.
  if (ts.isParenthesizedExpression(node)) return functionOf(node.expression);
  // A trailing comma inside those parens parses as a comma operator, so the
  // handler sits on the left of a BinaryExpression rather than alone.
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.CommaToken) {
    return functionOf(node.left) ?? functionOf(node.right);
  }
  return undefined;
}

function hasExportModifier(node: ts.Node): boolean {
  return (ts.getModifiers?.(node as ts.HasModifiers) ?? []).some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
  );
}

function collectCalls(source: ts.SourceFile, body: ts.Node): ExtractedCall[] {
  const calls: ExtractedCall[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      // A name that appears only in a string or comment never reaches here:
      // the AST records it as text, not as a CallExpression. That closes gap 1.
      if (name) calls.push({ name, line: lineOf(source, node) });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return calls;
}

/**
 * Reads `matcher` out of an exported `config` object.
 *
 * Only literals count. Next.js states that matcher values "need to be constants
 * so they can be statically analyzed at build-time" and ignores dynamic ones, so
 * a variable here is recorded as dynamic rather than resolved — inventing its
 * value would be inventing a barrier.
 */
function readRouteConfig(initializer: ts.Expression, line: number): ExtractedRouteConfig {
  const config: ExtractedRouteConfig = {
    matchers: [],
    hasDynamicMatcher: false,
    hasRequestConditions: false,
    line,
  };
  if (!ts.isObjectLiteralExpression(initializer)) {
    config.hasDynamicMatcher = true;
    return config;
  }

  const property = initializer.properties.find(
    (item): item is ts.PropertyAssignment =>
      ts.isPropertyAssignment(item) &&
      (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) &&
      item.name.text === "matcher",
  );
  if (!property) return config;

  // One matcher may be a bare string; several arrive as an array. Each element
  // is either a string or an object carrying `source` plus optional conditions.
  const entries = ts.isArrayLiteralExpression(property.initializer)
    ? [...property.initializer.elements]
    : [property.initializer];

  for (const entry of entries) {
    if (ts.isStringLiteralLike(entry)) {
      config.matchers.push(entry.text);
      continue;
    }
    if (ts.isObjectLiteralExpression(entry)) {
      for (const item of entry.properties) {
        if (!ts.isPropertyAssignment(item)) continue;
        const key = ts.isIdentifier(item.name) || ts.isStringLiteral(item.name) ? item.name.text : undefined;
        if (key === "source" && ts.isStringLiteralLike(item.initializer)) {
          config.matchers.push(item.initializer.text);
        } else if (key === "source") {
          config.hasDynamicMatcher = true;
        } else if (key === "has" || key === "missing") {
          // Applicability now depends on a header, cookie or query value that
          // does not exist at analysis time. Recorded so the barrier can be
          // treated as conditional instead of proven.
          config.hasRequestConditions = true;
        }
      }
      continue;
    }
    config.hasDynamicMatcher = true;
  }
  return config;
}

function inlineServerDirective(fn: ts.FunctionLikeDeclaration): boolean {
  const body = fn.body;
  if (!body || !ts.isBlock(body)) return false;
  return directivesOf(body.statements).includes("use server");
}

function describe(
  source: ts.SourceFile,
  name: string,
  fn: ts.FunctionLikeDeclaration,
  declarationNode: ts.Node,
): ExtractedFunction {
  return {
    name,
    line: lineOf(source, declarationNode),
    isInlineServerAction: inlineServerDirective(fn),
    calls: fn.body ? collectCalls(source, fn.body) : [],
  };
}

export function extractModule(fileName: string, text: string): ExtractedModule {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.ES2023,
    /* setParentNodes */ true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const functions: ExtractedFunction[] = [];
  const envReads: { name: string; line: number }[] = [];
  const localFunctions = new Map<string, ExtractedFunction>();
  const imports: ImportBinding[] = [];
  let routeConfig: ExtractedRouteConfig | undefined;

  // Imports and local declarations first: resolving a guard means knowing both
  // what this file defines and where a name came from.
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const from = statement.moduleSpecifier.text;
      const bindings = statement.importClause?.namedBindings;
      const line = lineOf(source, statement);
      if (statement.importClause?.name) {
        imports.push({ local: statement.importClause.name.text, from, line });
      }
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          imports.push({ local: element.name.text, from, line });
        }
      }
      continue;
    }

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      localFunctions.set(statement.name.text, describe(source, statement.name.text, statement, statement));
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        const direct = functionOf(declaration.initializer);
        if (direct) {
          localFunctions.set(declaration.name.text, describe(source, declaration.name.text, direct, declaration));
        }
      }
    }
  }

  for (const statement of source.statements) {
    // `export default handler` — a binding exported by reference. Resolved
    // against what the module already declared, so a middleware written this
    // way is still found. Named `default`, which is what a caller looks for.
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      if (ts.isIdentifier(statement.expression)) {
        const target = localFunctions.get(statement.expression.text);
        if (target) functions.push({ ...target, name: "default" });
        continue;
      }
      const inline = functionOf(statement.expression);
      if (inline) {
        functions.push(describe(source, "default", inline, statement));
        continue;
      }

      // `export default withAuth(async function middleware(req) {…})` — the
      // shape next-auth documents, and what shadcn-ui/taxonomy actually ships.
      // Same treatment as a wrapped route handler: the wrapper counts as a call
      // so it can act as evidence, and the inner body is still scanned.
      if (ts.isCallExpression(statement.expression)) {
        const wrapper = calleeName(statement.expression.expression);
        const inner = statement.expression.arguments.map(functionOf).find(Boolean);
        const calls: ExtractedCall[] = [];
        if (wrapper) calls.push({ name: wrapper, line: lineOf(source, statement) });
        if (inner?.body) calls.push(...collectCalls(source, inner.body));
        functions.push({
          name: "default",
          line: lineOf(source, statement),
          isInlineServerAction: inner ? inlineServerDirective(inner) : false,
          calls,
        });
      }
      continue;
    }

    if (!hasExportModifier(statement)) continue;

    // `export default async function (request) {…}` — legal and anonymous, so
    // there is no name to key it by. Next.js accepts it for middleware, and
    // skipping it would silently drop a real barrier.
    if (ts.isFunctionDeclaration(statement) && !statement.name) {
      const isDefault = (ts.getModifiers?.(statement) ?? []).some(
        (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
      );
      if (isDefault) {
        functions.push(describe(source, "default", statement, statement));
        continue;
      }
    }

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      functions.push(describe(source, statement.name.text, statement, statement));
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;

        // `export const config = { matcher: … }` is configuration, not a
        // handler, and must be read before the object-of-handlers branch below
        // would treat its properties as entry points.
        if (declaration.name.text === "config") {
          routeConfig = readRouteConfig(declaration.initializer, lineOf(source, declaration));
          continue;
        }

        const direct = functionOf(declaration.initializer);
        if (direct) {
          functions.push(describe(source, declaration.name.text, direct, declaration));
          continue;
        }

        // Object of handlers: `export const actions = { default: …, save: … }`.
        // SvelteKit form actions take this shape; each property is its own
        // entry point, named `actions.<key>` so the id stays unambiguous.
        if (ts.isObjectLiteralExpression(declaration.initializer)) {
          for (const property of declaration.initializer.properties) {
            if (!ts.isPropertyAssignment(property) && !ts.isMethodDeclaration(property)) continue;
            const key = property.name;
            if (!key || (!ts.isIdentifier(key) && !ts.isStringLiteral(key))) continue;
            const fn = ts.isMethodDeclaration(property)
              ? property
              : functionOf(property.initializer);
            if (!fn) continue;
            functions.push(
              describe(source, `${declaration.name.text}.${key.text}`, fn, property),
            );
          }
          continue;
        }

        // Wrapped handler: `export const DELETE = withAdmin(async () => {…})`.
        // The wrapper is recorded as a call so it can act as evidence, and the
        // inner function body is still scanned. This closes gap 3.
        if (ts.isCallExpression(declaration.initializer)) {
          const wrapper = calleeName(declaration.initializer.expression);
          const inner = declaration.initializer.arguments.map(functionOf).find(Boolean);
          const calls: ExtractedCall[] = [];
          if (wrapper) calls.push({ name: wrapper, line: lineOf(source, declaration) });
          if (inner?.body) calls.push(...collectCalls(source, inner.body));
          functions.push({
            name: declaration.name.text,
            line: lineOf(source, declaration),
            isInlineServerAction: inner ? inlineServerDirective(inner) : false,
            calls,
          });
        }
      }
    }
  }

  // SvelteKit exposes configuration as named imports from `$env/*` rather than
  // through `process.env`, so both shapes have to be recorded for the model to
  // mean the same thing across adapters.
  for (const binding of imports) {
    if (binding.from.startsWith("$env/")) {
      envReads.push({ name: binding.local, line: binding.line });
    }
  }

  const visitEnv = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      calleeName(node.expression) === "process.env"
    ) {
      envReads.push({ name: node.name.text, line: lineOf(source, node) });
    }
    ts.forEachChild(node, visitEnv);
  };
  ts.forEachChild(source, visitEnv);

  return {
    // `parseDiagnostics` is not on the public SourceFile type but is what the
    // parser records; there is no public way to ask "did this parse cleanly"
    // without building a Program, which would need module resolution.
    hasSyntaxErrors:
      ((source as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics ?? []).length > 0,
    moduleDirectives: directivesOf(source.statements),
    functions,
    ...(routeConfig ? { routeConfig } : {}),
    envReads,
    localFunctions,
    imports,
  };
}
