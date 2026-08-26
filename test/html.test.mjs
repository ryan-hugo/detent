import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanNextProject } from '../dist/adapters/nextjs/scan.js';
import { renderDiffHtml, renderModelHtml } from '../dist/reporters/html.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'fixtures', 'next-basic');

function stripStyle(html) {
  return html.replace(/<style>[\s\S]*?<\/style>/, '');
}

test('model report is self-contained and offline', () => {
  const html = renderModelHtml(scanNextProject(fixture));

  assert.match(html, /^<!doctype html>/);
  assert.doesNotMatch(html, /https?:\/\//, 'must not reference any remote origin');
  assert.doesNotMatch(stripStyle(html), /<script/i, 'must not ship script tags');
});

test('model report renders every finding and entry point', () => {
  const model = scanNextProject(fixture);
  const html = renderModelHtml(model);

  for (const finding of model.findings) {
    assert.ok(html.includes(finding.ruleId), `missing rule ${finding.ruleId}`);
    assert.ok(html.includes(String(finding.location.line)), 'missing evidence line');
  }
  for (const entry of model.entryPoints) {
    assert.ok(html.includes(entry.location.file), `missing entry point ${entry.id}`);
  }
});

test('access lattice tallies every entry point across the four levels', () => {
  const model = scanNextProject(fixture);
  const html = renderModelHtml(model);

  for (const level of ['admin', 'authenticated', 'unknown', 'public']) {
    assert.ok(html.includes(`rung-name ${level}`), `lattice must show the ${level} rung`);
  }

  const ticks = html.match(/class="tick [a-z]+"/g) ?? [];
  assert.equal(ticks.length, model.entryPoints.length, 'one tick per entry point');
});

test('hostile identifiers are escaped, not injected as markup', () => {
  const html = renderModelHtml({
    schemaVersion: 1,
    generatedAt: 'now',
    root: '<img src=x onerror=alert(1)>',
    framework: { name: 'nextjs', confidence: 1 },
    entryPoints: [{
      id: 'x',
      kind: 'server-action',
      exportName: '<script>alert(1)</script>',
      location: { file: 'a"><b>.ts', line: 1 },
      directives: [],
      authSignals: [],
      inferredAccess: 'public',
      sensitiveOperations: [],
    }],
    clientBoundaries: [],
    environment: [],
    findings: [],
  });
  const body = stripStyle(html);

  assert.doesNotMatch(body, /<script/i, 'script tag must not survive escaping');
  assert.doesNotMatch(body, /<img/i, 'img tag must not survive escaping');
  assert.ok(body.includes('&lt;script&gt;'), 'hostile input should appear escaped');
});

test('diff report shows the access transition and marks only blocking changes', () => {
  const html = renderDiffHtml([
    { type: 'access-broadened', severity: 'high', id: 'action:a.ts:x', before: 'admin', after: 'public' },
    { type: 'entry-point-added', severity: 'info', entryPoint: {
      id: 'route:GET:/new', kind: 'route-handler', method: 'GET', exportName: 'GET', route: '/new',
      location: { file: 'app/api/new/route.ts', line: 1 }, directives: [], authSignals: [],
      inferredAccess: 'public', sensitiveOperations: [] } },
  ], '/tmp/app');

  assert.ok(html.includes('action:a.ts:x'), 'the weakened entry point must be named');
  assert.ok(html.includes('route:GET:/new'), 'the added entry point must be named');
  assert.match(html, /admin[\s\S]{0,120}public/, 'the admin -> public move must be shown');

  const blockingMarks = html.match(/class="blocking"/g) ?? [];
  assert.equal(blockingMarks.length, 1, 'only the weakening change is blocking');
});

test('empty diff renders a clean state instead of an empty page', () => {
  const html = renderDiffHtml([], '/tmp/app');

  assert.ok(html.includes('identical to the recorded baseline'), 'must state the model is unchanged');
  assert.doesNotMatch(html, /class="blocking"/, 'nothing is blocking when nothing moved');
});
