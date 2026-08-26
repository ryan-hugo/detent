import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanNextProject } from '../dist/adapters/nextjs/scan.js';
import { ConfigError, EMPTY_CONFIG, parseConfig } from '../dist/core/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const vocab = path.join(here, 'fixtures', 'next-custom-vocab');

test('a configured guard establishes access the built-in vocabulary would miss', () => {
  const model = scanNextProject(vocab);
  const entry = model.entryPoints.find((item) => item.route === '/api/pedidos');

  assert.ok(entry, 'the route should be discovered');
  assert.equal(entry.inferredAccess, 'admin', 'exigirGestor is mapped to admin');
  assert.ok(entry.authSignals.some((signal) => signal.name === 'exigirGestor'));
  assert.ok(
    entry.sensitiveOperations.some((operation) => operation.category === 'payment'),
    'enviarCobranca is mapped to a payment operation',
  );
});

test('notGuards overrides a built-in name heuristic', () => {
  const model = scanNextProject(vocab);
  const entry = model.entryPoints.find((item) => item.route === '/api/relatorio');

  assert.ok(entry);
  assert.deepEqual(entry.authSignals, [], 'checkAdminBanner is denied as evidence');
  assert.equal(entry.inferredAccess, 'public', 'without evidence the route is public');
  assert.ok(
    model.findings.some((finding) => finding.ruleId === 'AUTH001'),
    'the unguarded write must now be reported',
  );
});

test('a project with no config keeps the built-in vocabulary', () => {
  const model = scanNextProject(path.join(here, 'fixtures', 'next-basic'));
  const entry = model.entryPoints.find((item) => item.exportName === 'adminRefundPayment');

  assert.ok(entry);
  assert.equal(entry.inferredAccess, 'admin');
});

test('parseConfig accepts an empty object', () => {
  assert.deepEqual(parseConfig({}), EMPTY_CONFIG);
});

test('parseConfig rejects an unknown access level instead of ignoring it', () => {
  // Silently dropping a typo would read as "no guard", which is the unsafe default.
  assert.throws(() => parseConfig({ guards: { x: 'superuser' } }), ConfigError);
  assert.throws(() => parseConfig({ sensitive: { x: 'nuclear' } }), ConfigError);
  assert.throws(() => parseConfig({ notGuards: 'x' }), ConfigError);
  assert.throws(() => parseConfig([]), ConfigError);
});

test('a dotted callee matches a guard configured by its base name', () => {
  const model = scanNextProject(vocab);
  const entry = model.entryPoints.find((item) => item.route === '/api/faturas');

  assert.ok(entry, 'the route should be discovered');
  assert.ok(
    entry.authSignals.some((signal) => signal.name === 'guards.exigirGestor'),
    'guards.exigirGestor() should resolve through the base name exigirGestor',
  );
  assert.equal(entry.inferredAccess, 'admin');
});

test('an inherited Object.prototype member is never mistaken for a guard', () => {
  // Found against a real repository: `searchParams.toString()` resolved through
  // the prototype chain of a plain lookup object and came back as a function,
  // which read as truthy evidence of an authorization barrier.
  const config = parseConfig({ guards: { requireAdmin: 'admin' } });

  for (const inherited of ['toString', 'constructor', 'valueOf', 'hasOwnProperty']) {
    assert.equal(config.guards[inherited], undefined, `${inherited} must not resolve`);
    assert.equal(config.sensitive[inherited], undefined, `${inherited} must not resolve`);
  }
  assert.equal(config.guards['requireAdmin'], 'admin', 'real entries still work');
});
