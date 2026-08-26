import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanNextProject } from '../dist/adapters/nextjs/scan.js';

function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'detent-walk-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const api = path.join(root, 'app', 'api', 'x');
  fs.mkdirSync(api, { recursive: true });
  fs.writeFileSync(path.join(api, 'route.ts'), 'export async function GET(){ await db.x.create({}); }');
  return root;
}

test('a directory symlink is not followed', (t) => {
  const root = project(t);
  try {
    fs.symlinkSync(path.join(root, 'app'), path.join(root, 'app', 'self'), 'junction');
  } catch {
    t.skip('symlink creation not permitted here');
    return;
  }

  // Following the link would invent one phantom route per level of descent.
  const model = scanNextProject(root);
  assert.equal(model.entryPoints.length, 1, 'exactly the one real route');
  assert.equal(model.entryPoints[0].route, '/api/x');
});

test('skipped directories stay skipped', (t) => {
  const root = project(t);
  for (const dir of ['node_modules', '.next', 'dist']) {
    const nested = path.join(root, dir, 'app', 'api', 'y');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'route.ts'), 'export async function DELETE(){ await db.y.delete({}); }');
  }

  const model = scanNextProject(root);
  assert.equal(model.entryPoints.length, 1, 'vendored trees must not be scanned');
});

test('a non-source file with a .ts name does not crash the scan', (t) => {
  const root = project(t);
  fs.writeFileSync(path.join(root, 'app', 'binary.ts'), Buffer.from([0, 1, 2, 255, 254, 0, 77]));

  const model = scanNextProject(root);
  assert.equal(model.entryPoints.length, 1, 'the real route is still found');
});
