import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanNextProject } from '../dist/adapters/nextjs/scan.js';
import { suggestVocabulary } from '../dist/core/vocabulary.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('a guard inside a helper is followed, not missed', () => {
  // The handler itself contains no evidence: it delegates. Before call
  // resolution this read as `public` and fired AUTH001 on protected code.
  const model = scanNextProject(path.join(here, 'fixtures', 'next-helper-chain'));
  const entry = model.entryPoints.find((item) => item.method === 'DELETE');

  assert.ok(entry);
  assert.equal(entry.inferredAccess, 'admin', 'the guard one call deep counts');
  assert.ok(entry.authSignals.some((signal) => signal.name === 'requireAdmin'));
  assert.ok(
    entry.sensitiveOperations.some((operation) => operation.category === 'database-write'),
    'the operation inside the helper is seen too',
  );
  assert.deepEqual(model.findings, [], 'a genuinely guarded route must stay quiet');
});

test('signature verification counts as authentication', () => {
  // shadcn-ui/taxonomy's Stripe webhook was reported as unprotected: an HMAC
  // check is stronger than a session lookup, and constructEvent throws on a
  // bad signature.
  const model = scanNextProject(path.join(here, 'fixtures', 'next-webhook'));
  const entry = model.entryPoints[0];

  assert.ok(entry);
  assert.equal(entry.inferredAccess, 'authenticated');
  assert.ok(entry.authSignals.some((signal) => signal.name.includes('constructEvent')));
  assert.deepEqual(model.findings, []);
});

test('call resolution does not read outside the project root', (t) => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'detent-outside-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'detent-root-'));
  t.after(() => {
    fs.rmSync(outside, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  });

  // A guard that lives outside the scanned tree must not be believed.
  fs.writeFileSync(path.join(outside, 'evil.ts'), 'export async function requireAdmin(){}\n');
  const api = path.join(root, 'app', 'api', 'x');
  fs.mkdirSync(api, { recursive: true });
  fs.writeFileSync(
    path.join(api, 'route.ts'),
    `import { requireAdmin } from "${path.join(outside, 'evil').split(path.sep).join('/')}";\n` +
      `export async function DELETE(){ await requireAdmin(); await db.users.delete({}); }\n`,
  );

  const model = scanNextProject(root);
  const entry = model.entryPoints[0];
  // The name still matches the built-in heuristic, which is fine — what must
  // not happen is the scanner reading a file outside the root to decide.
  assert.ok(entry, 'the route is still modelled');
});

test('vocabulary is inferred from wrappers that front many entry points', () => {
  const entryPoints = Array.from({ length: 10 }, (_, index) => ({
    id: `route:GET:/api/${index}`,
    kind: 'route-handler',
    exportName: 'GET',
    location: { file: `app/api/${index}/route.ts`, line: 1 },
    directives: [],
    authSignals: [],
    inferredAccess: 'public',
    sensitiveOperations: [],
    reachableCalls: index < 6 ? ['withTenant', 'db.rows.findMany'] : ['db.rows.findMany'],
  }));

  const [top] = suggestVocabulary(entryPoints);
  assert.ok(top, 'a wrapper on 6 of 10 entry points should be suggested');
  assert.equal(top.name, 'withTenant');
  assert.equal(top.access, 'authenticated');
  assert.equal(top.coverage, 6);
});

test('inference does not propose ordinary data calls as guards', () => {
  const entryPoints = Array.from({ length: 10 }, (_, index) => ({
    id: `route:GET:/api/${index}`,
    kind: 'route-handler',
    exportName: 'GET',
    location: { file: `app/api/${index}/route.ts`, line: 1 },
    directives: [],
    authSignals: [],
    inferredAccess: 'public',
    sensitiveOperations: [],
    reachableCalls: ['json', 'db.rows.findMany', 'headers'],
  }));

  assert.deepEqual(suggestVocabulary(entryPoints), [], 'ubiquity alone is not evidence');
});

test('inference stays silent on a project too small to judge', () => {
  const entryPoints = [
    {
      id: 'route:GET:/api/a',
      kind: 'route-handler',
      exportName: 'GET',
      location: { file: 'app/api/a/route.ts', line: 1 },
      directives: [],
      authSignals: [],
      inferredAccess: 'public',
      sensitiveOperations: [],
      reachableCalls: ['withThing'],
    },
  ];
  assert.deepEqual(suggestVocabulary(entryPoints), []);
});
