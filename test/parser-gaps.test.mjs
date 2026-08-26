/**
 * Regression tests for the parser gaps recorded in docs/roadmap/phase-0.md.
 *
 * These described wrong behavior until P0.1 replaced lexical scanning with the
 * TypeScript AST. They now pass and must keep passing: each one guards against
 * a specific way the extractor can start inventing or losing evidence.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanNextProject } from '../dist/adapters/nextjs/scan.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('gap 1: a guard named only in a string or comment is not a guard', () => {
  const model = scanNextProject(path.join(here, 'fixtures', 'next-dead-text'));
  const entry = model.entryPoints.find((item) => item.method === 'DELETE');

  assert.ok(entry, 'the route handler should be discovered');
  assert.deepEqual(entry.authSignals, [], 'dead text must not produce authorization evidence');
  assert.equal(entry.inferredAccess, 'public');
  assert.ok(
    model.findings.some((finding) => finding.ruleId === 'AUTH001'),
    'an unguarded delete must still be reported',
  );
});

test('gap 2: function-level "use server" does not make the whole module a server module', () => {
  const model = scanNextProject(path.join(here, 'fixtures', 'next-inline-action'));

  const names = model.entryPoints.map((entry) => entry.exportName).sort();
  assert.deepEqual(names, ['deleteAccount'], 'only the directive-carrying function is an entry point');
});

test('gap 3: a wrapped route handler is discovered and its wrapper counts as evidence', () => {
  const model = scanNextProject(path.join(here, 'fixtures', 'next-wrapped-handler'));
  const entry = model.entryPoints.find((item) => item.exportName === 'DELETE');

  assert.ok(entry, 'export const DELETE = withAdmin(...) must be discovered');
  assert.equal(entry.kind, 'route-handler');
  assert.equal(entry.route, '/api/reports');
  assert.ok(
    entry.authSignals.some((signal) => signal.name === 'withAdmin'),
    'the wrapper is the authorization evidence',
  );
  assert.equal(entry.inferredAccess, 'admin');
  assert.ok(
    entry.sensitiveOperations.some((operation) => operation.category === 'database-write'),
    'the wrapped body must still be scanned',
  );
});

test('gap 5: a handler wrapped only in grouping parens is still discovered', () => {
  // Found against a real repository: removing a wrapper by hand leaves
  // `export const POST = (async () => {…},)`, which parses as a comma operator
  // inside a parenthesized expression rather than a call.
  const model = scanNextProject(path.join(here, 'fixtures', 'next-bare-handler'));
  const entry = model.entryPoints.find((item) => item.exportName === 'POST');

  assert.ok(entry, 'the handler must not disappear because of grouping parens');
  assert.equal(entry.route, '/api/bare');
  assert.equal(entry.inferredAccess, 'public', 'no wrapper means no evidence');
  assert.ok(model.findings.some((finding) => finding.ruleId === 'AUTH001'));
});

test('a guard that runs after the operation is reported, not credited', () => {
  // Adversarial case: the guard exists, so name matching alone reads the route
  // as admin. Position is the evidence that it never protected anything.
  const model = scanNextProject(path.join(here, 'fixtures', 'next-late-guard'));
  const entry = model.entryPoints.find((item) => item.method === 'DELETE');

  assert.ok(entry);
  const late = model.findings.find((finding) => finding.ruleId === 'AUTH003');
  assert.ok(late, 'AUTH003 must fire when authorization comes too late');
  assert.equal(late.severity, 'high');
  assert.ok(
    late.evidence.firstGuardLine > late.evidence.sensitiveOperationLine,
    'the finding must carry the positions it reasoned from',
  );
});

test('a guard placed before the operation does not trigger AUTH003', () => {
  const model = scanNextProject(path.join(here, 'fixtures', 'next-wrapped-handler'));
  assert.ok(!model.findings.some((finding) => finding.ruleId === 'AUTH003'));
});

test('an unguarded action with no observed sensitive operation is not reported', () => {
  // vercel/commerce reported all six of its entry points before this: anonymous
  // cart actions that legitimately have no session. A finding needs observed
  // evidence, not the mere shape of a server action.
  const model = scanNextProject(path.join(here, 'fixtures', 'next-benign-action'));
  const entry = model.entryPoints.find((item) => item.exportName === 'setTheme');

  assert.ok(entry, 'the action is still modelled');
  assert.equal(entry.inferredAccess, 'public');
  assert.deepEqual(model.findings, [], 'no operation observed means no finding');
});
