import assert from 'node:assert/strict';
import test from 'node:test';
import { diffModels } from '../dist/core/diff.js';

const base = {
  schemaVersion: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  root: '/tmp/app',
  framework: { name: 'nextjs', confidence: 1 },
  clientBoundaries: [],
  environment: [],
  findings: [],
};

test('detects broadened access', () => {
  const before = {
    ...base,
    entryPoints: [{
      id: 'route:DELETE:/api/admin/users', kind: 'route-handler', method: 'DELETE', exportName: 'DELETE', route: '/api/admin/users',
      location: { file: 'app/api/admin/users/route.ts', line: 1 }, directives: [], authSignals: [], inferredAccess: 'admin', sensitiveOperations: [],
    }],
  };
  const after = {
    ...before,
    entryPoints: [{ ...before.entryPoints[0], inferredAccess: 'authenticated' }],
  };

  const changes = diffModels(before, after);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].type, 'access-broadened');
});
