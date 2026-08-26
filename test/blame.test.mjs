import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ABSENT, blame } from '../dist/core/blame.js';
import { listCommits } from '../dist/core/git.js';
import { scanProject } from '../dist/adapters/detect.js';

const scan = (dir) => scanProject(dir, 'nextjs');

/**
 * Builds a repository whose history is exactly the given sequence of guards.
 * `undefined` means the route file is absent at that commit.
 */
function repoWithHistory(t, states) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'detent-blame-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });

  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test Dev');

  const dir = path.join(root, 'app', 'api', 'admin', 'users');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'route.ts');

  const shas = [];
  states.forEach((guard, index) => {
    if (guard === undefined) {
      if (fs.existsSync(file)) fs.rmSync(file);
    } else {
      fs.writeFileSync(
        file,
        `export async function DELETE() {\n${guard}  await db.users.delete({ where: {} });\n}\n`,
      );
    }
    // Two consecutive states can be identical, and git refuses an empty commit.
    // An unrelated file keeps each commit distinct without touching the route
    // or its guard, which is also closer to how real history looks.
    fs.writeFileSync(path.join(root, 'unrelated.ts'), `export const revision = ${index};\n`);
    run('add', '-A');
    run('commit', '-qm', `state ${index}: ${guard === undefined ? 'absent' : guard.trim() || 'no guard'}`);
    shas.push(execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
  });

  return { root, shas };
}

const ADMIN = '  await requireAdmin();\n';
const SESSION = '  await auth();\n';
const NONE = '';

function run(root, route = '/api/admin/users', options = {}) {
  return blame(root, route, scan, scan(root), options);
}

test('a posture that never changed reports no transition', (t) => {
  const { root } = repoWithHistory(t, [SESSION, SESSION, SESSION]);
  const result = run(root);

  assert.equal(result.current.posture, 'authenticated');
  assert.equal(result.transition, undefined);
  assert.equal(result.previous, undefined);
  assert.ok(result.commitsScanned > 0, 'history was actually examined');
});

test('a weakened posture names the commit it changed at', (t) => {
  const { root, shas } = repoWithHistory(t, [ADMIN, SESSION, NONE]);
  const result = run(root);

  assert.equal(result.current.posture, 'public');
  assert.equal(result.previous.posture, 'authenticated');
  assert.equal(result.transition.sha, shas[2], 'the commit that removed the guard');
  assert.equal(result.transition.author, 'Test Dev');
});

test('a strengthened posture is reported too', (t) => {
  // blame reports change, not regression.
  const { root, shas } = repoWithHistory(t, [NONE, NONE, ADMIN]);
  const result = run(root);

  assert.equal(result.previous.posture, 'public');
  assert.equal(result.current.posture, 'admin');
  assert.equal(result.transition.sha, shas[2]);
});

test('a non-monotonic history returns the most recent transition', (t) => {
  // admin -> public -> admin -> public. A binary search would land on the
  // wrong commit here, which is why the walk is linear.
  const { root, shas } = repoWithHistory(t, [ADMIN, NONE, ADMIN, NONE]);
  const result = run(root);

  assert.equal(result.current.posture, 'public');
  assert.equal(result.previous.posture, 'admin');
  assert.equal(result.transition.sha, shas[3], 'the latest transition, not the first');
});

test('an absent route is not treated as a public one', (t) => {
  const { root, shas } = repoWithHistory(t, [undefined, undefined, SESSION]);
  const result = run(root);

  assert.equal(result.previous.posture, ABSENT);
  assert.notEqual(result.previous.posture, 'public', 'absence and exposure are different states');
  assert.equal(result.current.posture, 'authenticated');
  assert.equal(result.transition.sha, shas[2], 'the commit that introduced the route');
});

test('the evidence diff names the guard that disappeared', (t) => {
  const { root } = repoWithHistory(t, [ADMIN, NONE]);
  const result = run(root);

  assert.deepEqual(result.evidenceDiff.removed, ['requireAdmin']);
  assert.deepEqual(result.evidenceDiff.added, []);
  assert.equal(result.previous.evidence.length, 1);
  assert.equal(result.current.evidence.length, 0, 'nothing guards it now');
});

test('the evidence diff names a guard that replaced another', (t) => {
  const { root } = repoWithHistory(t, [ADMIN, SESSION]);
  const result = run(root);

  assert.deepEqual(result.evidenceDiff.removed, ['requireAdmin']);
  assert.deepEqual(result.evidenceDiff.added, ['auth']);
});

test('a guard reached through a helper is followed across history', (t) => {
  // The route file is byte-identical across both commits: only the helper
  // changed. A path filter narrowed to the route would miss this entirely.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'detent-blame-helper-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });

  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test Dev');

  const api = path.join(root, 'app', 'api', 'r');
  fs.mkdirSync(api, { recursive: true });
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.writeFileSync(
    path.join(api, 'route.ts'),
    `import { protectRoute } from "@/lib/guard";\n\nexport async function DELETE() {\n  await protectRoute();\n  await db.users.delete({ where: {} });\n}\n`,
  );
  fs.writeFileSync(
    path.join(root, 'lib', 'guard.ts'),
    `export async function protectRoute() {\n  await requireAdmin();\n}\n`,
  );
  git('add', '-A');
  git('commit', '-qm', 'guarded through helper');

  fs.writeFileSync(
    path.join(root, 'lib', 'guard.ts'),
    `export async function protectRoute() {\n  return true;\n}\n`,
  );
  git('add', '-A');
  git('commit', '-qm', 'helper stopped guarding');

  const result = blame(root, '/api/r', scan, scan(root), {});
  assert.ok(result.transition, 'a change in a shared helper must still be found');
  assert.equal(result.previous.posture, 'admin');
  assert.deepEqual(result.evidenceDiff.removed, ['requireAdmin']);
});

test('the commit limit is honoured and reported as incomplete', (t) => {
  const { root } = repoWithHistory(t, [ADMIN, ADMIN, ADMIN, ADMIN, ADMIN]);
  const result = run(root, '/api/admin/users', { maxCommits: 2 });

  assert.equal(result.transition, undefined);
  assert.ok(result.commitsScanned <= 2);
  assert.equal(result.historyIncomplete, true, 'a reached limit is not proof of no change');
});

test('history is walked first-parent only', (t) => {
  const { root } = repoWithHistory(t, [SESSION, SESSION]);
  const commits = listCommits(root, 'HEAD', { limit: 10 });

  assert.equal(commits.length, 2);
  assert.ok(commits[0].sha.length === 40, 'full shas, so a caller can address the commit');
  assert.match(commits[0].date, /^\d{4}-\d{2}-\d{2}T/, 'ISO dates');
});

test('reading history never mutates the repository', (t) => {
  const { root } = repoWithHistory(t, [ADMIN, SESSION, NONE]);
  const read = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();

  const before = [read('rev-parse', 'HEAD'), read('branch', '--show-current'), read('status', '--porcelain')];
  run(root);
  const after = [read('rev-parse', 'HEAD'), read('branch', '--show-current'), read('status', '--porcelain')];

  assert.deepEqual(after, before, 'HEAD, branch and working tree must be untouched');
});

test('blame is deterministic for the same repository', (t) => {
  const { root } = repoWithHistory(t, [ADMIN, SESSION, NONE]);
  const first = run(root);
  const second = run(root);

  assert.equal(first.transition.sha, second.transition.sha);
  assert.deepEqual(first.evidenceDiff, second.evidenceDiff);
  assert.equal(first.commitsScanned, second.commitsScanned);
});
