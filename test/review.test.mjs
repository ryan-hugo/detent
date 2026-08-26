import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ABSENT, review } from '../dist/core/review.js';
import { withTree } from '../dist/core/git.js';
import { scanProject } from '../dist/adapters/detect.js';

const scan = (dir) => scanProject(dir, 'nextjs');

/**
 * Commits `before`, writes `after` into the working tree without committing,
 * and returns the two models the way `detent review` builds them.
 */
function change(t, before, after) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'detent-review-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });

  const write = (files) => {
    for (const [relative, source] of Object.entries(files)) {
      const full = path.join(root, relative);
      if (source === null) {
        if (fs.existsSync(full)) fs.rmSync(full);
        continue;
      }
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, source);
    }
  };

  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test Dev');
  write(before);
  git('add', '-A');
  git('commit', '-qm', 'before');

  write(after);

  const beforeModel = withTree(root, 'HEAD', (dir) => scan(dir));
  return { root, result: review(beforeModel, scan(root)) };
}

const route = (guard, name = 'a') =>
  `export async function DELETE() {\n${guard}  await db.${name}.delete({ where: {} });\n}\n`;

const ADMIN = '  await requireAdmin();\n';
const SESSION = '  await auth();\n';
const NONE = '';

test('an unchanged posture produces no change', (t) => {
  const { result } = change(t, { 'app/api/a/route.ts': route(SESSION) }, {});

  assert.deepEqual(result.postureChanges, []);
  assert.deepEqual(result.evidenceChanges, []);
  assert.equal(result.regressionCount, 0);
});

test('a weakened posture is a regression', (t) => {
  const { result } = change(
    t,
    { 'app/api/a/route.ts': route(ADMIN) },
    { 'app/api/a/route.ts': route(SESSION) },
  );

  assert.equal(result.postureChanges.length, 1);
  assert.equal(result.postureChanges[0].kind, 'regression');
  assert.equal(result.postureChanges[0].before, 'admin');
  assert.equal(result.postureChanges[0].after, 'authenticated');
  assert.equal(result.regressionCount, 1);
});

test('a strengthened posture is an improvement, not a regression', (t) => {
  const { result } = change(
    t,
    { 'app/api/a/route.ts': route(NONE) },
    { 'app/api/a/route.ts': route(ADMIN) },
  );

  assert.equal(result.postureChanges[0].kind, 'improvement');
  assert.equal(result.regressionCount, 0);
  assert.equal(result.improvementCount, 1);
});

test('a new unguarded route is new surface, not a regression', (t) => {
  const { result } = change(
    t,
    { 'app/api/a/route.ts': route(ADMIN) },
    { 'app/api/b/route.ts': route(NONE, 'b') },
  );

  const added = result.postureChanges.find((item) => item.subject === '/api/b');
  assert.ok(added);
  assert.equal(added.before, ABSENT, 'it did not exist before, which is not the same as public');
  assert.equal(added.kind, 'added-surface');
  assert.equal(result.regressionCount, 0, 'adding a route is not weakening an existing one');
});

test('a new guarded route is reported separately from an unguarded one', (t) => {
  const { result } = change(
    t,
    { 'app/api/a/route.ts': route(ADMIN) },
    { 'app/api/b/route.ts': route(ADMIN, 'b') },
  );

  const added = result.postureChanges.find((item) => item.subject === '/api/b');
  assert.equal(added.kind, 'added-protected-surface');
});

test('a removed route is not reported as exposure', (t) => {
  const { result } = change(
    t,
    { 'app/api/a/route.ts': route(SESSION), 'app/api/b/route.ts': route(SESSION, 'b') },
    { 'app/api/b/route.ts': null },
  );

  const removed = result.postureChanges.find((item) => item.subject === '/api/b');
  assert.equal(removed.after, ABSENT);
  assert.equal(removed.kind, 'removed-surface');
  assert.equal(result.regressionCount, 0);
});

test('swapping one guard for an equal one changes evidence, not posture', (t) => {
  const { result } = change(
    t,
    { 'app/api/a/route.ts': route('  await auth();\n') },
    { 'app/api/a/route.ts': route('  await getSession();\n') },
  );

  assert.deepEqual(result.postureChanges, [], 'the answer did not move');
  assert.equal(result.evidenceChanges.length, 1, 'but the reason did');
  assert.deepEqual(result.evidenceChanges[0].evidenceRemoved, ['auth']);
  assert.deepEqual(result.evidenceChanges[0].evidenceAdded, ['getSession']);
});

test('dependency is not consequence', (t) => {
  // Three routes reach sharedGuard. Only two lose their posture when it stops
  // guarding, because the third has a guard of its own.
  const shared = (name, extra = '') =>
    `import { sharedGuard } from "@/lib/shared";\nexport async function DELETE() {\n  await sharedGuard();\n${extra}  await db.${name}.delete({ where: {} });\n}\n`;

  const { result } = change(
    t,
    {
      'lib/shared.ts': `export async function sharedGuard() { await requireAdmin(); }\n`,
      'app/api/a/route.ts': shared('a'),
      'app/api/b/route.ts': shared('b'),
      'app/api/c/route.ts': shared('c', '  await requireAdmin();\n'),
    },
    { 'lib/shared.ts': `export async function sharedGuard() { return true; }\n` },
  );

  const regressions = result.postureChanges.filter((item) => item.kind === 'regression');
  assert.equal(regressions.length, 2, 'only two postures actually moved');
  assert.deepEqual(regressions.map((item) => item.subject).sort(), ['/api/a', '/api/b']);

  const unchanged = result.evidenceChanges.find((item) => item.subject === '/api/c');
  assert.ok(unchanged, 'the third route kept its posture through its own guard');
  assert.equal(unchanged.after, 'admin');

  const dependency = result.dependencies.find((item) => item.symbol === 'sharedGuard');
  assert.ok(dependency);
  assert.equal(dependency.reachableCount, 3, 'three routes depend on it');
  assert.notEqual(dependency.reachableCount, regressions.length, 'dependency is not consequence');
});

test('a changed helper that moves no posture reports no regression', (t) => {
  const { result } = change(
    t,
    {
      'lib/util.ts': `export function label() { return "a"; }\n`,
      'app/api/a/route.ts': `import { label } from "@/lib/util";\nexport async function DELETE() {\n  await requireAdmin();\n  return Response.json({ l: label() });\n}\n`,
    },
    { 'lib/util.ts': `export function label() { return "b"; }\n` },
  );

  assert.equal(result.regressionCount, 0);
  assert.deepEqual(result.postureChanges, []);
});

test('review never mutates the repository', (t) => {
  const { root } = change(
    t,
    { 'app/api/a/route.ts': route(ADMIN) },
    { 'app/api/a/route.ts': route(NONE) },
  );
  const read = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();

  const head = read('rev-parse', 'HEAD');
  const branch = read('branch', '--show-current');
  const status = read('status', '--porcelain');

  // The uncommitted edit must still be there, untouched, after analysis.
  assert.match(status, /route\.ts/, 'the working-tree change is preserved');
  const beforeModel = withTree(root, 'HEAD', (dir) => scan(dir));
  review(beforeModel, scan(root));

  assert.equal(read('rev-parse', 'HEAD'), head);
  assert.equal(read('branch', '--show-current'), branch);
  assert.equal(read('status', '--porcelain'), status);
});

test('review reuses the scanner classification rather than recomputing it', (t) => {
  const { root, result } = change(
    t,
    { 'app/api/a/route.ts': route(ADMIN) },
    { 'app/api/a/route.ts': route(SESSION) },
  );
  const model = scan(root);

  assert.equal(
    result.postureChanges[0].after,
    model.entryPoints[0].inferredAccess,
    'the reported posture is the one the scanner produced',
  );
});

test('the same two states produce the same result', (t) => {
  const { root } = change(
    t,
    { 'app/api/a/route.ts': route(ADMIN) },
    { 'app/api/a/route.ts': route(NONE) },
  );
  const before = withTree(root, 'HEAD', (dir) => scan(dir));

  const first = review(before, scan(root));
  const second = review(before, scan(root));
  assert.deepEqual(second, first);
});

test('a file that does not parse is reported as incomplete analysis', (t) => {
  // Half-typed code is normal mid-edit. A route missing from a broken file
  // looks exactly like a deleted one, so silence here would be dishonest.
  const { result } = change(
    t,
    { 'app/api/a/route.ts': route(ADMIN) },
    { 'app/api/a/route.ts': 'export async function DELETE(){ await requireAdmin(' },
  );

  assert.deepEqual(result.unparsedFiles, ['app/api/a/route.ts']);
});

test('a clean tree reports no unparsed files', (t) => {
  const { result } = change(t, { 'app/api/a/route.ts': route(ADMIN) }, {});
  assert.deepEqual(result.unparsedFiles, []);
});
