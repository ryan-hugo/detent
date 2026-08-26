import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { GitError, isGitRepository, resolveRef, withTree } from '../dist/core/git.js';
import { scanNextProject } from '../dist/adapters/nextjs/scan.js';

/** Builds a throwaway repo: `main` has a guard, `feature` removes it. */
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'detent-test-'));
  const run = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });

  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'test');

  const actions = path.join(root, 'app', 'actions');
  fs.mkdirSync(actions, { recursive: true });
  const file = path.join(actions, 'billing.ts');

  fs.writeFileSync(file, `'use server';\n\nexport async function refund() {\n  await requireAdmin();\n  await stripe.refunds.create({ payment_intent: "pi_1" });\n}\n`);
  run('add', '-A');
  run('commit', '-qm', 'guarded');

  run('checkout', '-qb', 'feature');
  fs.writeFileSync(file, `'use server';\n\nexport async function refund() {\n  await stripe.refunds.create({ payment_intent: "pi_1" });\n}\n`);
  run('commit', '-qam', 'unguarded');

  return root;
}

test('a git tree can be scanned without touching the working tree', (t) => {
  const root = makeRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.ok(isGitRepository(root));

  const baseAccess = withTree(root, 'main', (dir) => {
    const model = scanNextProject(dir);
    return model.entryPoints.find((entry) => entry.exportName === 'refund')?.inferredAccess;
  });
  const headAccess = scanNextProject(root).entryPoints
    .find((entry) => entry.exportName === 'refund')?.inferredAccess;

  assert.equal(baseAccess, 'admin', 'the base tree still has the guard');
  assert.equal(headAccess, 'public', 'the working tree has lost it');

  const status = execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' });
  assert.equal(status.trim(), '', 'reading history must not dirty the working tree');
  const branch = execFileSync('git', ['-C', root, 'branch', '--show-current'], { encoding: 'utf8' });
  assert.equal(branch.trim(), 'feature', 'the checked-out branch must not change');
});

test('withTree removes its temporary directory', (t) => {
  const root = makeRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const dir = withTree(root, 'main', (d) => d);
  assert.equal(fs.existsSync(dir), false, 'the materialized tree is cleaned up');
});

test('a ref name cannot inject a shell command', (t) => {
  const root = makeRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const marker = path.join(os.tmpdir(), `detent-injection-${Date.now()}`);
  assert.throws(() => resolveRef(root, `main; touch ${marker}`), GitError);
  assert.equal(fs.existsSync(marker), false, 'the injected command must not run');
});

test('an unknown ref reports the ref by name', (t) => {
  const root = makeRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.throws(
    () => resolveRef(root, 'no-such-branch'),
    (error) => error instanceof GitError && error.message.includes('no-such-branch'),
  );
});

test('a directory that is not a repository is reported, not crashed on', () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'detent-plain-'));
  try {
    assert.equal(isGitRepository(plain), false);
  } finally {
    fs.rmSync(plain, { recursive: true, force: true });
  }
});

test('the base tree carries its own detent.config.json', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'detent-cfg-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });

  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'test');

  const api = path.join(root, 'app', 'api', 'x');
  fs.mkdirSync(api, { recursive: true });
  fs.writeFileSync(path.join(root, 'detent.config.json'), '{"guards":{"exigirGestor":"admin"}}');
  fs.writeFileSync(
    path.join(api, 'route.ts'),
    `export async function DELETE() {\n  await exigirGestor();\n  await db.users.delete({ where: {} });\n}\n`,
  );
  run('add', '-A');
  run('commit', '-qm', 'guarded');

  // The guard is only recognized because the config is part of the tree.
  const access = withTree(root, 'main', (dir) => {
    const model = scanNextProject(dir);
    return model.entryPoints[0]?.inferredAccess;
  });
  assert.equal(access, 'admin', 'project vocabulary must apply to the historical tree');
});

test('a project nested in a monorepo resolves its own paths', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'detent-mono-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });

  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'test');

  // The scanned project is apps/web, not the repository root.
  const project = path.join(root, 'apps', 'web');
  const actions = path.join(project, 'app', 'actions');
  fs.mkdirSync(actions, { recursive: true });
  fs.writeFileSync(path.join(root, 'README.md'), 'monorepo\n');
  fs.writeFileSync(
    path.join(actions, 'billing.ts'),
    `'use server';\n\nexport async function refund() {\n  await requireAdmin();\n  await stripe.refunds.create({ payment_intent: "pi_1" });\n}\n`,
  );
  run('add', '-A');
  run('commit', '-qm', 'guarded');

  const access = withTree(project, 'main', (dir) => {
    const model = scanNextProject(dir);
    return model.entryPoints.find((entry) => entry.exportName === 'refund')?.inferredAccess;
  });

  assert.equal(access, 'admin', 'the nested project must be readable from history');
});
