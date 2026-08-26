import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanNextProject } from '../dist/adapters/nextjs/scan.js';
import { scanSvelteKitProject } from '../dist/adapters/sveltekit/scan.js';
import { ExplainError, explain, findEntryPoints, knownSubjects } from '../dist/core/explain.js';
import { renderExplanations } from '../dist/reporters/text.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => path.join(here, 'fixtures', name);

/* ---- the chain survives the scan ---- */

test('an inline guard is recorded with an empty chain', () => {
  const model = scanNextProject(fixture('next-basic'));
  const entry = model.entryPoints.find((item) => item.route === '/api/profile');
  const signal = entry.authSignals.find((item) => item.name === 'auth');

  assert.ok(signal, 'the guard is still detected');
  assert.ok(
    signal.via === undefined || signal.via.length === 0,
    'a call written in the handler has nothing to traverse',
  );
});

test('a guard reached through a helper keeps the chain that found it', () => {
  const model = scanNextProject(fixture('next-helper-chain'));
  const entry = model.entryPoints.find((item) => item.method === 'DELETE');
  const signal = entry.authSignals.find((item) => item.name === 'requireAdmin');

  assert.ok(signal, 'the guard one call deep is still detected');
  assert.deepEqual(signal.via, ['performDelete'], 'the chain is the evidence, and it is kept');
});

test('the SvelteKit adapter records chains the same way', () => {
  const model = scanSvelteKitProject(fixture('sveltekit-basic'));
  const entry = model.entryPoints.find((item) => item.exportName === 'actions.safeRemove');

  assert.ok(entry);
  const signal = entry.authSignals.find((item) => item.name === 'requireAdmin');
  assert.ok(signal, 'both adapters must produce the same evidence shape');
  assert.ok(Array.isArray(signal.via ?? []));
});

/* ---- explain reports, it does not reason ---- */

test('explain reports the access the scanner already concluded', () => {
  const model = scanNextProject(fixture('next-helper-chain'));
  const [explanation] = explain(model, '/api/delegating');
  const entry = model.entryPoints.find((item) => item.method === 'DELETE');

  assert.equal(explanation.access, entry.inferredAccess, 'explain must not re-classify');
  assert.equal(explanation.evidence.length, entry.authSignals.length);
  assert.deepEqual(explanation.evidence[0].via, ['performDelete']);
});

test('a route with several methods explains all of them', () => {
  // Answering for one method would hide the one the user did not ask about.
  const model = scanNextProject(fixture('next-basic'));
  const explanations = explain(model, '/api/profile');

  const methods = explanations.map((item) => item.method).sort();
  assert.deepEqual(methods, ['GET', 'PATCH']);
});

test('evidence is ordered strongest first', () => {
  const model = scanNextProject(fixture('next-basic'));
  const [explanation] = explain(model, 'adminRefundPayment');

  assert.ok(explanation.evidence.length > 0);
  assert.equal(explanation.evidence[0].access, explanation.access, 'the deciding signal leads');
});

test('an entry point with no guard says so instead of showing nothing', () => {
  const model = scanNextProject(fixture('next-bare-handler'));
  const [explanation] = explain(model, '/api/bare');

  assert.equal(explanation.access, 'public');
  assert.deepEqual(explanation.evidence, []);

  const text = renderExplanations([explanation]);
  assert.match(text, /none detected/, 'absence must be stated, not left blank');
});

/* ---- lookup and errors ---- */

test('an entry point can be found by route, export name or id', () => {
  const model = scanNextProject(fixture('next-basic'));

  assert.equal(findEntryPoints(model, '/api/profile').length, 2);
  assert.equal(findEntryPoints(model, 'refundPayment').length, 1);
  const id = model.entryPoints[0].id;
  assert.equal(findEntryPoints(model, id).length, 1);
});

test('a trailing slash is tolerated', () => {
  const model = scanNextProject(fixture('next-basic'));
  assert.equal(findEntryPoints(model, '/api/profile/').length, 2);
});

test('an unknown route raises rather than returning an empty explanation', () => {
  const model = scanNextProject(fixture('next-basic'));

  assert.throws(() => explain(model, '/does/not/exist'), ExplainError);
  assert.deepEqual(findEntryPoints(model, ''), [], 'an empty query matches nothing');
  assert.ok(knownSubjects(model).includes('/api/profile'), 'the error can list real options');
});

/* ---- the rendered chain matches the model ---- */

test('the rendered chain reads in call order and names its source', () => {
  const model = scanNextProject(fixture('next-helper-chain'));
  const text = renderExplanations(explain(model, '/api/delegating'));

  const performIndex = text.indexOf('performDelete()');
  const requireIndex = text.indexOf('requireAdmin()');
  assert.ok(performIndex >= 0 && requireIndex > performIndex, 'the helper precedes what it calls');
  assert.match(text, /establishes: admin/);
  assert.match(text, /route\.ts:\d+/, 'evidence carries a location');
});

test('explain is deterministic for the same tree', () => {
  const first = renderExplanations(explain(scanNextProject(fixture('next-helper-chain')), '/api/delegating'));
  const second = renderExplanations(explain(scanNextProject(fixture('next-helper-chain')), '/api/delegating'));
  assert.equal(first, second);
});

test('a chain never repeats a function', () => {
  // The resolver guards against cycles; this asserts the guarantee survives
  // into the model, because a repeated name would read as a real call loop.
  for (const name of ['next-basic', 'next-helper-chain', 'sveltekit-basic']) {
    const scan = name.startsWith('sveltekit') ? scanSvelteKitProject : scanNextProject;
    for (const entry of scan(fixture(name)).entryPoints) {
      for (const signal of entry.authSignals) {
        const via = signal.via ?? [];
        assert.equal(new Set(via).size, via.length, `${name}: ${signal.name} has a repeated hop`);
      }
    }
  }
});
