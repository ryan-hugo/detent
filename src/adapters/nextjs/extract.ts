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

export interface ExtractedModule {
  /** Directives that apply to the whole module (top of file only). */
  moduleDirectives: string[];
  functions: ExtractedFunction[];
  /** `process.env.X` reads anywhere in the file. */
  envReads: { name: string; line: number }[];
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

  for (const statement of source.statements) {
    if (!hasExportModifier(statement)) continue;

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      functions.push(describe(source, statement.name.text, statement, statement));
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;

        const direct = functionOf(declaration.initializer);
        if (direct) {
          functions.push(describe(source, declaration.name.text, direct, declaration));
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
    moduleDirectives: directivesOf(source.statements),
    functions,
    envReads,
  };
}
