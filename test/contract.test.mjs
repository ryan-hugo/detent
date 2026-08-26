import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanNextProject } from '../dist/adapters/nextjs/scan.js';
import { ContractError, checkContract, parseContract } from '../dist/core/contract.js';
import { renderContractHtml, renderGraphHtml } from '../dist/reporters/html.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'fixtures', 'next-basic');

function stripStyle(html) {
  return html.replace(/<style>[\s\S]*?<\/style>/, '');
}

test('an entry point below the required access level is a breach', () => {
  const model = scanNextProject(fixture);
  const breaches = checkContract(
    parseContract({
      requirements: [{ rule: 'entry-point-requires-access', match: '/api/admin/*', access: 'admin' }],
    }),
    model,
  );

  assert.equal(breaches.length, 1);
  assert.equal(breaches[0].rule, 'entry-point-requires-access');
  assert.equal(breaches[0].actual, 'authenticated', 'the fixture route is authenticated, not admin');
  assert.ok(breaches[0].location.file.includes('admin'));
});

test('an entry point at or above the required level is not a breach', () => {
  const model = scanNextProject(fixture);
  const breaches = checkContract(
    parseContract({
      requirements: [{ rule: 'entry-point-requires-access', match: '/api/profile', access: 'authenticated' }],
    }),
    model,
  );

  assert.deepEqual(breaches, [], 'authenticated satisfies a requirement for authenticated');
});

test('a server-only variable read from a client module is a breach', () => {
  const model = scanNextProject(fixture);
  const breaches = checkContract(
    parseContract({ requirements: [{ rule: 'env-is-server-only', name: 'STRIPE_SECRET_KEY' }] }),
    model,
  );

  assert.equal(breaches.length, 1);
  assert.match(breaches[0].actual, /use client/);
});

test('an unguarded sensitive operation is a breach, a guarded one is not', () => {
  const model = scanNextProject(fixture);
  const breaches = checkContract(
    parseContract({ requirements: [{ rule: 'sensitive-operation-requires-guard', category: 'payment' }] }),
    model,
  );

  const subjects = breaches.map((breach) => breach.subject);
  assert.ok(subjects.some((subject) => subject.includes('refundPayment')));
  assert.ok(
    !subjects.some((subject) => subject.includes('adminRefundPayment')),
    'the guarded action must not be reported',
  );
});

test('a malformed requirement is rejected, not skipped', () => {
  assert.throws(() => parseContract({ requirements: [{ rule: 'nope' }] }), ContractError);
  assert.throws(
    () => parseContract({ requirements: [{ rule: 'entry-point-requires-access', match: '/x', access: 'root' }] }),
    ContractError,
  );
  assert.throws(() => parseContract({ requirements: 'x' }), ContractError);
  assert.deepEqual(parseContract({}).requirements, []);
});

test('contract report states the expectation and what the model shows', () => {
  const breaches = checkContract(
    parseContract({
      requirements: [{ rule: 'entry-point-requires-access', match: '/api/admin/*', access: 'admin' }],
    }),
    scanNextProject(fixture),
  );
  const html = renderContractHtml(breaches, 1, '/tmp/app');

  assert.ok(html.includes('requires admin'), 'the expectation must be visible');
  assert.ok(html.includes('authenticated'), 'the actual value must be visible');
  assert.doesNotMatch(stripStyle(html), /<script/i);
  assert.doesNotMatch(html, /https?:\/\//);
});

test('graph draws one path per entry point and flags the unbarriered ones', () => {
  const model = scanNextProject(fixture);
  const html = renderGraphHtml(model);

  const chains = html.match(/class="chain"/g) ?? [];
  assert.equal(chains.length, model.entryPoints.length, 'one chain per entry point');

  assert.ok(html.includes('no barrier'), 'an unguarded path must show the gap');
  assert.ok(html.includes('payment'), 'the reached operation must be named');
  assert.doesNotMatch(stripStyle(html), /<script/i);
  assert.doesNotMatch(html, /https?:\/\//);
});

test('a fully guarded project reports no open path', () => {
  const html = renderGraphHtml(scanNextProject(path.join(here, 'fixtures', 'next-wrapped-handler')));
  assert.ok(html.includes('passes a barrier'), 'the clean verdict must be stated');
  assert.ok(!html.includes('no barrier'), 'no gap should be drawn');
});
