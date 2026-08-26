import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSvelteKitProject } from '../dist/adapters/sveltekit/scan.js';
import { detectFramework, scanProject, AdapterError } from '../dist/adapters/detect.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'fixtures', 'sveltekit-basic');

test('SvelteKit +server.ts method exports are route handlers', () => {
  const model = scanSvelteKitProject(fixture);
  const entry = model.entryPoints.find((item) => item.method === 'DELETE');

  assert.ok(entry, '+server.ts DELETE must be discovered');
  assert.equal(entry.route, '/api/users');
  assert.equal(entry.inferredAccess, 'public');
});

test('form actions become one entry point per key', () => {
  const model = scanSvelteKitProject(fixture);
  const names = model.entryPoints
    .filter((item) => item.exportName.startsWith('actions.'))
    .map((item) => item.exportName)
    .sort();

  assert.deepEqual(names, ['actions.removeUser', 'actions.safeRemove']);

  const guarded = model.entryPoints.find((item) => item.exportName === 'actions.safeRemove');
  assert.equal(guarded.inferredAccess, 'admin', 'the guarded action keeps its guard');
  const unguarded = model.entryPoints.find((item) => item.exportName === 'actions.removeUser');
  assert.equal(unguarded.inferredAccess, 'public', 'the sibling without one does not inherit it');
});

test('server load is an entry point, client load is not', () => {
  const model = scanSvelteKitProject(fixture);

  assert.ok(
    model.entryPoints.some((item) => item.exportName === 'load' && item.route === '/settings'),
    '+page.server.ts load runs on the server',
  );
  assert.ok(
    model.clientBoundaries.some((boundary) => boundary.file.endsWith('+page.ts')),
    '+page.ts ships to the browser',
  );
  assert.ok(
    !model.entryPoints.some((item) => item.location.file.endsWith('+page.ts')),
    'a client file holds no server entry point',
  );
});

test('$env/static/public is treated as client-visible configuration', () => {
  const model = scanSvelteKitProject(fixture);
  const usage = model.environment.find((item) => item.name === 'PUBLIC_API_TOKEN');

  assert.ok(usage, 'a $env import must be recorded like process.env is');
  assert.equal(usage.clientVisible, true);
  assert.ok(
    model.findings.some((finding) => finding.ruleId === 'ENV001'),
    'a secret-shaped public variable is still reported',
  );
});

test('framework detection prefers the manifest over layout', () => {
  assert.equal(detectFramework(fixture), 'sveltekit');
  assert.equal(detectFramework(path.join(here, 'fixtures', 'next-basic')), 'nextjs');
});

test('an undetectable project is refused, not guessed at', (t) => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'detent-empty-'));
  t.after(() => fs.rmSync(empty, { recursive: true, force: true }));

  assert.equal(detectFramework(empty), undefined);
  assert.throws(() => scanProject(empty), AdapterError);
});

test('an explicit framework overrides detection', () => {
  // A SvelteKit fixture scanned as Next.js finds nothing, which is the point:
  // the override is honoured rather than silently corrected.
  const model = scanProject(fixture, 'nextjs');
  assert.equal(model.framework.name, 'nextjs');
  assert.equal(model.entryPoints.length, 0);
});

test('a malformed package.json falls back to layout detection', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'detent-bad-manifest-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.writeFileSync(path.join(root, 'package.json'), '{ not json');
  fs.mkdirSync(path.join(root, 'src', 'routes'), { recursive: true });

  assert.equal(detectFramework(root), 'sveltekit', 'layout decides when the manifest cannot');
});
