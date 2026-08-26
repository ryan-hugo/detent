import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findSymbols, impact, knownSymbols } from '../dist/core/impact.js';
import { scanNextProject } from '../dist/adapters/nextjs/scan.js';

/** Writes a throwaway Next.js project from a map of relative path to source. */
function project(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'detent-impact-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, source] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, source);
  }
  return scanNextProject(root);
}

/** Resolves a query to exactly one symbol, failing the test if it does not. */
function one(model, query) {
  const matches = findSymbols(model, query);
  assert.equal(matches.length, 1, `expected one symbol for ${query}`);
  return matches[0];
}

test('a symbol called in the handler is a direct dependency', (t) => {
  const model = project(t, {
    'app/api/a/route.ts': `export async function DELETE() {\n  await requireAdmin();\n  await db.a.delete({});\n}\n`,
  });
  const result = impact(model, one(model, 'requireAdmin'));

  assert.equal(result.reachableCount, 1);
  assert.equal(result.entryPoints[0].relationship, 'direct');
  assert.deepEqual(result.entryPoints[0].via, []);
});

test('a symbol behind two helpers is a transitive dependency', (t) => {
  const model = project(t, {
    'lib/outer.ts': `import { inner } from "@/lib/inner";\nexport async function outer() { await inner(); }\n`,
    'lib/inner.ts': `export async function inner() { await requireAdmin(); }\n`,
    'app/api/a/route.ts': `import { outer } from "@/lib/outer";\nexport async function DELETE() {\n  await outer();\n  await db.a.delete({});\n}\n`,
  });
  const result = impact(model, one(model, 'requireAdmin'));

  assert.equal(result.reachableCount, 1);
  assert.equal(result.entryPoints[0].relationship, 'transitive');
  assert.deepEqual(result.entryPoints[0].via, ['outer', 'inner'], 'the chain is the one the resolver walked');
});

test('a shared guard reports every entry point that reaches it', (t) => {
  const model = project(t, {
    'lib/guard.ts': `export async function sharedGuard() { await requireAdmin(); }\n`,
    'app/api/a/route.ts': `import { sharedGuard } from "@/lib/guard";\nexport async function DELETE() { await sharedGuard(); await db.a.delete({}); }\n`,
    'app/api/b/route.ts': `import { sharedGuard } from "@/lib/guard";\nexport async function DELETE() { await sharedGuard(); await db.b.delete({}); }\n`,
    'app/api/c/route.ts': `import { sharedGuard } from "@/lib/guard";\nexport async function DELETE() { await sharedGuard(); await db.c.delete({}); }\n`,
  });
  const result = impact(model, one(model, 'sharedGuard'));

  assert.equal(result.reachableCount, 3);
  assert.deepEqual(result.entryPoints.map((item) => item.subject).sort(), ['/api/a', '/api/b', '/api/c']);
});

test('an entry point reaching a symbol by two paths is counted once', (t) => {
  const model = project(t, {
    'lib/two.ts': `export async function pathA() { await requireAdmin(); }\nexport async function pathB() { await requireAdmin(); }\n`,
    'app/api/a/route.ts': `import { pathA, pathB } from "@/lib/two";\nexport async function DELETE() {\n  await pathA();\n  await pathB();\n  await db.a.delete({});\n}\n`,
  });
  const result = impact(model, one(model, 'requireAdmin'));

  assert.equal(result.reachableCount, 1, 'blast radius counts routes, not paths');
  assert.equal(result.entryPoints.length, 1);
});

test('reachability and security evidence are different claims', (t) => {
  // formatDate is reached by both routes and guards neither.
  const model = project(t, {
    'lib/util.ts': `export function formatDate(value) { return String(value); }\n`,
    'app/api/x/route.ts': `import { formatDate } from "@/lib/util";\nexport async function GET() { await auth(); return Response.json({ at: formatDate(1) }); }\n`,
    'app/api/y/route.ts': `import { formatDate } from "@/lib/util";\nexport async function GET() { return Response.json({ at: formatDate(1) }); }\n`,
  });
  const result = impact(model, one(model, 'formatDate'));

  assert.equal(result.reachableCount, 2, 'both routes reach it');
  assert.equal(result.securityEvidenceCount, 0, 'it decides no access level');
});

test('a guard is reported as security evidence', (t) => {
  const model = project(t, {
    'lib/guard.ts': `export async function requireAdmin2() { await requireAdmin(); }\n`,
    'app/api/a/route.ts': `import { requireAdmin2 } from "@/lib/guard";\nexport async function DELETE() { await requireAdmin2(); await db.a.delete({}); }\n`,
  });
  const result = impact(model, one(model, 'requireAdmin'));

  assert.equal(result.securityEvidenceCount, 1);
  assert.equal(result.entryPoints[0].securityEvidence, true);
  assert.equal(result.entryPoints[0].access, 'admin', 'impact reports the access, it does not recompute it');
});

test('same-named symbols resolving differently are not merged', (t) => {
  const model = project(t, {
    'auth/admin.ts': `export async function requireUser() { await requireAdmin(); }\n`,
    'auth/customer.ts': `export async function requireUser() { await auth(); }\n`,
    'app/api/a/route.ts': `import { requireUser } from "@/auth/admin";\nexport async function DELETE() { await requireUser(); await db.a.delete({}); }\n`,
    'app/api/b/route.ts': `import { requireUser } from "@/auth/customer";\nexport async function DELETE() { await requireUser(); await db.b.delete({}); }\n`,
  });

  // The two routes are classified differently, which is the proof the model
  // kept them apart rather than merging on name.
  const a = model.entryPoints.find((entry) => entry.route === '/api/a');
  const b = model.entryPoints.find((entry) => entry.route === '/api/b');
  assert.equal(a.inferredAccess, 'admin');
  assert.equal(b.inferredAccess, 'authenticated');

  // `requireAdmin` is reached only through auth/admin.ts, never through the other.
  const adminOnly = impact(model, one(model, 'requireAdmin'));
  assert.deepEqual(adminOnly.entryPoints.map((item) => item.subject), ['/api/a']);
});

test('a file-qualified query selects one call site', (t) => {
  const model = project(t, {
    'app/api/a/route.ts': `export async function DELETE() { await requireAdmin(); await db.a.delete({}); }\n`,
    'app/api/b/route.ts': `export async function DELETE() { await requireAdmin(); await db.b.delete({}); }\n`,
  });

  const both = impact(model, one(model, 'requireAdmin'));
  assert.equal(both.reachableCount, 2, 'the bare name covers every call site');

  const scoped = impact(model, one(model, 'app/api/a/route.ts#requireAdmin'));
  assert.deepEqual(scoped.entryPoints.map((item) => item.subject), ['/api/a']);
});

test('a symbol nothing reaches is different from a symbol that does not exist', (t) => {
  const model = project(t, {
    'lib/unused.ts': `export function neverCalled() { return 1; }\n`,
    'app/api/a/route.ts': `export async function GET() { return Response.json({}); }\n`,
  });

  assert.deepEqual(findSymbols(model, 'neverCalled'), [], 'never reached, so not in the model');
  assert.deepEqual(findSymbols(model, 'doesNotExistAnywhere'), []);
  assert.ok(knownSymbols(model).length > 0, 'the model still knows other symbols');
});

test('a cycle between helpers terminates', (t) => {
  const model = project(t, {
    'lib/a.ts': `import { b } from "@/lib/b";\nexport async function a() { await b(); await requireAdmin(); }\n`,
    'lib/b.ts': `import { a } from "@/lib/a";\nexport async function b() { await a(); }\n`,
    'app/api/a/route.ts': `import { a } from "@/lib/a";\nexport async function DELETE() { await a(); await db.a.delete({}); }\n`,
  });

  const result = impact(model, one(model, 'requireAdmin'));
  assert.equal(result.reachableCount, 1, 'the cycle does not duplicate the route');
  assert.ok(result.entryPoints[0].via.length <= 4, 'nor produce an unbounded chain');
});

test('impact does not reclassify entry points', (t) => {
  const model = project(t, {
    'app/api/a/route.ts': `export async function DELETE() { await requireAdmin(); await db.a.delete({}); }\n`,
  });
  const before = model.entryPoints.map((entry) => entry.inferredAccess);
  impact(model, one(model, 'requireAdmin'));
  const after = model.entryPoints.map((entry) => entry.inferredAccess);

  assert.deepEqual(after, before, 'the model is read, never rewritten');
});

test('the same model produces the same result', (t) => {
  const model = project(t, {
    'lib/guard.ts': `export async function sharedGuard() { await requireAdmin(); }\n`,
    'app/api/b/route.ts': `import { sharedGuard } from "@/lib/guard";\nexport async function DELETE() { await sharedGuard(); await db.b.delete({}); }\n`,
    'app/api/a/route.ts': `import { sharedGuard } from "@/lib/guard";\nexport async function DELETE() { await sharedGuard(); await db.a.delete({}); }\n`,
  });

  const first = impact(model, one(model, 'sharedGuard'));
  const second = impact(model, one(model, 'sharedGuard'));
  assert.deepEqual(second, first);
  assert.deepEqual(
    first.entryPoints.map((item) => item.subject),
    ['/api/a', '/api/b'],
    'ordering is by name, not by traversal order',
  );
});
