import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanNextProject } from '../dist/adapters/nextjs/scan.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('a function name is not treated as its own authorization guard', () => {
  const model = scanNextProject(path.join(here, 'fixtures', 'next-unguarded-admin'));
  const entry = model.entryPoints.find((item) => item.exportName === 'adminDeleteEverything');

  assert.ok(entry, 'expected the server action to be discovered');
  assert.deepEqual(entry.authSignals, [], 'declaration header must not contribute auth signals');
  assert.equal(entry.inferredAccess, 'public');
  assert.ok(model.findings.some((finding) => finding.ruleId === 'AUTH001'));
});

test('a real in-body guard still confers admin access', () => {
  const model = scanNextProject(path.join(here, 'fixtures', 'next-basic'));
  const entry = model.entryPoints.find((item) => item.exportName === 'adminRefundPayment');

  assert.ok(entry);
  assert.equal(entry.inferredAccess, 'admin');
});
