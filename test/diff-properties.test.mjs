import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffModels } from '../dist/core/diff.js';
import { scanNextProject } from '../dist/adapters/nextjs/scan.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const model = () => scanNextProject(path.join(here, 'fixtures', 'next-basic'));

test('a model does not differ from itself', () => {
  const m = model();
  assert.deepEqual(diffModels(m, m), [], 'identity must produce no changes');
});

test('weakening is reported and tightening is not', () => {
  const m = model();
  const weaker = { ...m, entryPoints: m.entryPoints.map((e) => ({ ...e, inferredAccess: 'public' })) };

  const loosened = diffModels(m, weaker);
  assert.ok(
    loosened.some((change) => change.type === 'access-broadened'),
    'dropping every guard must be reported',
  );
  assert.ok(loosened.every((change) => change.severity !== 'info' || change.type === 'entry-point-added'));

  const tightened = diffModels(weaker, m);
  assert.ok(
    !tightened.some((change) => change.type === 'access-broadened'),
    'adding guards is an improvement, never a regression',
  );
});

test('a removed entry point is not misreported as added', () => {
  const m = model();
  const fewer = { ...m, entryPoints: m.entryPoints.slice(1) };
  const changes = diffModels(m, fewer);

  assert.ok(!changes.some((change) => change.type === 'entry-point-added'));
  // Known limitation, asserted so it stays a decision rather than a surprise:
  // removals are silent. Deleting a route shrinks the attack surface, but a
  // route deleted and re-added unguarded currently shows only as an addition.
  assert.deepEqual(changes, [], 'removals are intentionally not reported yet');
});

test('a secret newly exposed to the client is critical', () => {
  const m = model();
  const before = { ...m, environment: [] };
  const changes = diffModels(before, m);

  const exposure = changes.find((change) => change.type === 'client-secret-exposure-added');
  assert.ok(exposure, 'the fixture exposes NEXT_PUBLIC_INTERNAL_TOKEN');
  assert.equal(exposure.severity, 'critical');
});
