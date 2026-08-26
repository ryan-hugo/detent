import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EnrichError, enrichFindings, parseSarif } from '../dist/core/enrich.js';
import { checkContract, parseContract, ContractError } from '../dist/core/contract.js';
import { renderContractMarkdown, renderDiffMarkdown } from '../dist/reporters/markdown.js';
import { scanNextProject } from '../dist/adapters/nextjs/scan.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function entry(route, access) {
  return {
    id: `route:GET:${route}`,
    kind: 'route-handler',
    method: 'GET',
    exportName: 'GET',
    route,
    location: { file: `app${route}/route.ts`, line: 1 },
    directives: [],
    authSignals: [],
    inferredAccess: access,
    sensitiveOperations: [],
  };
}

function model(entryPoints) {
  return {
    schemaVersion: 1,
    generatedAt: 'now',
    root: '/x',
    framework: { name: 'nextjs', confidence: 1 },
    clientBoundaries: [],
    environment: [],
    findings: [],
    entryPoints,
  };
}

function sarif(results) {
  return { version: '2.1.0', runs: [{ tool: { driver: { name: 't' } }, results }] };
}

function result(uri, line = 1, ruleId = 'r') {
  return {
    ruleId,
    message: { text: 'm' },
    locations: [{ physicalLocation: { artifactLocation: { uri }, region: { startLine: line } } }],
  };
}

/* ---- contract: the two new invariants ---- */

test('siblings-agree-on-access finds the one route that was forgotten', () => {
  const breaches = checkContract(
    parseContract({ requirements: [{ rule: 'siblings-agree-on-access', match: '/api/admin/*' }] }),
    model([entry('/api/admin/a', 'admin'), entry('/api/admin/b', 'admin'), entry('/api/admin/c', 'public')]),
  );

  assert.equal(breaches.length, 1, 'only the divergent route is a breach');
  assert.ok(breaches[0].subject.endsWith('/api/admin/c'));
  assert.equal(breaches[0].actual, 'public');
});

test('siblings-agree-on-access is silent when the group agrees, or is too small', () => {
  const contract = parseContract({ requirements: [{ rule: 'siblings-agree-on-access', match: '/api/*' }] });

  assert.deepEqual(
    checkContract(contract, model([entry('/api/a', 'admin'), entry('/api/b', 'admin')])),
    [],
    'a consistent group holds',
  );
  assert.deepEqual(
    checkContract(contract, model([entry('/api/a', 'public')])),
    [],
    'a single route has no sibling to disagree with',
  );
});

test('no-public-entry-point catches a route added after the contract was written', () => {
  const breaches = checkContract(
    parseContract({ requirements: [{ rule: 'no-public-entry-point', match: '/api/internal/*' }] }),
    model([entry('/api/internal/old', 'admin'), entry('/api/internal/new', 'public')]),
  );

  assert.equal(breaches.length, 1);
  assert.ok(breaches[0].subject.endsWith('/api/internal/new'));
});

test('the new rules still reject a malformed requirement', () => {
  assert.throws(() => parseContract({ requirements: [{ rule: 'siblings-agree-on-access' }] }), ContractError);
  assert.throws(() => parseContract({ requirements: [{ rule: 'no-public-entry-point', match: 4 }] }), ContractError);
});

/* ---- triage: SARIF enrichment ---- */

test('reachability reorders findings a scanner rated the same', () => {
  const enriched = enrichFindings(
    model([entry('/api/open', 'public'), entry('/api/locked', 'admin')]),
    parseSarif(sarif([result('app/api/locked/route.ts'), result('app/api/open/route.ts')])),
  );

  assert.equal(enriched[0].priority, 'critical', 'the publicly reachable one sorts first');
  assert.ok(enriched[0].file.includes('open'));
  assert.equal(enriched[1].priority, 'low', 'admin-only is not the same emergency');
});

test('a finding on no known path is reported, not dropped', () => {
  const enriched = enrichFindings(
    model([entry('/api/a', 'public')]),
    parseSarif(sarif([result('lib/never-called.ts')])),
  );

  assert.equal(enriched.length, 1, 'unreachable is still a finding');
  assert.equal(enriched[0].priority, 'low');
  assert.deepEqual(enriched[0].reachedBy, []);
  assert.equal(enriched[0].reachableAt, undefined);
});

test('malformed SARIF is refused or skipped, never crashed on', () => {
  assert.throws(() => parseSarif(null), EnrichError);
  assert.throws(() => parseSarif([]), EnrichError);
  assert.throws(() => parseSarif({}), EnrichError);

  // Individual malformed results are skipped so one bad entry cannot lose a run.
  assert.deepEqual(parseSarif(sarif([{}, { ruleId: 'x' }])), []);
  assert.deepEqual(parseSarif({ runs: [{ results: 'not-an-array' }] }), []);
});

test('enrichment never opens the files a SARIF names', () => {
  // A traversal path must be inert: matching is by string, not by read.
  const enriched = enrichFindings(
    model([entry('/api/a', 'public')]),
    parseSarif(sarif([result('../../../etc/passwd')])),
  );
  assert.equal(enriched[0].priority, 'low');
  assert.deepEqual(enriched[0].reachedBy, []);
});

/* ---- markdown: PR surface ---- */

test('diff markdown states the verdict and keeps the table intact', () => {
  const body = renderDiffMarkdown(
    [{ type: 'access-broadened', severity: 'high', id: 'route:GET:/a|b', before: 'admin', after: 'public' }],
    'origin/main',
  );

  assert.match(body, /### Security diff/);
  assert.match(body, /weakens the model/);
  assert.ok(body.includes('origin/main'), 'the base ref is named');
  const row = body.split('\n').find((line) => line.startsWith('| 🔴'));
  assert.ok(row.includes(`${String.fromCharCode(92)}|`), 'a pipe in an id must not break the table');
});

test('empty diff markdown says nothing moved', () => {
  const body = renderDiffMarkdown([]);
  assert.match(body, /Nothing moved/);
  assert.ok(!body.includes('| ---'), 'no table when there is nothing to tabulate');
});

test('contract markdown reports expected against actual', () => {
  const breaches = checkContract(
    parseContract({ requirements: [{ rule: 'no-public-entry-point', match: '/api/*' }] }),
    model([entry('/api/a', 'public')]),
  );
  const body = renderContractMarkdown(breaches, 1);

  assert.match(body, /### Security contract/);
  assert.match(body, /1 of 1/);
  assert.ok(body.includes('public'), 'the actual value is shown');
});

test('markdown reporters agree with the model they were given', () => {
  const real = scanNextProject(path.join(here, 'fixtures', 'next-basic'));
  const breaches = checkContract(
    parseContract({ requirements: [{ rule: 'siblings-agree-on-access', match: '/api/*' }] }),
    real,
  );
  const body = renderContractMarkdown(breaches, 1);
  const rows = body.split('\n').filter((line) => line.startsWith('| `'));
  assert.equal(rows.length, breaches.length, 'one row per breach, no more');
});
