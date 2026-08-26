import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanNextProject } from '../dist/adapters/nextjs/scan.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'fixtures', 'next-basic');

test('extracts Next.js security model and deterministic findings', () => {
  const model = scanNextProject(fixture);

  assert.equal(model.framework.name, 'nextjs');
  assert.equal(model.entryPoints.length, 5);
  assert.ok(model.entryPoints.some((entry) => entry.id.includes('refundPayment') && entry.inferredAccess === 'public'));
  assert.ok(model.entryPoints.some((entry) => entry.id.includes('adminRefundPayment') && entry.inferredAccess === 'admin'));

  const ruleIds = new Set(model.findings.map((finding) => finding.ruleId));
  assert.ok(ruleIds.has('AUTH001'));
  assert.ok(ruleIds.has('AUTH002'));
  assert.ok(ruleIds.has('ENV001'));
  assert.ok(ruleIds.has('ENV002'));
});
