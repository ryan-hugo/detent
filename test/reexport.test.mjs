import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanProject } from '../dist/adapters/detect.js';

/** Builds a throwaway Next.js project and scans it. */
function project(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'detent-rx-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, source] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, source);
  }
  fs.writeFileSync(path.join(root, 'package.json'), '{"dependencies":{"next":"15.0.0"}}');
  return scanProject(root, 'nextjs');
}

const at = (model, method) => model.entryPoints.find((entry) => entry.method === method);
const WRITE = 'await db.users.delete({ where: {} });';

test('a locally re-exported handler is discovered', (t) => {
  // `export { handler as GET }` exported nothing the extractor could see, so
  // the route vanished from the model entirely — worse than a wrong label,
  // because an unguarded route simply was not there to be reported.
  const model = project(t, {
    'app/api/t/route.ts': `async function handler() {\n  ${WRITE}\n}\nexport { handler as GET };\n`,
  });

  assert.equal(model.entryPoints.length, 1);
  assert.equal(model.entryPoints[0].route, '/api/t');
  assert.equal(model.entryPoints[0].method, 'GET');
});

test('one function exported under several methods is several entry points', (t) => {
  const model = project(t, {
    'app/api/t/route.ts': `async function handler() {\n  ${WRITE}\n}\nexport { handler as GET, handler as DELETE };\n`,
  });

  assert.equal(model.entryPoints.length, 2);
  assert.deepEqual(model.entryPoints.map((entry) => entry.method).sort(), ['DELETE', 'GET']);
});

test('the body of a re-exported handler is still analysed', (t) => {
  // The whole point: a re-export must not become a route with no contents.
  const model = project(t, {
    'app/api/t/route.ts': `async function handler() {\n  ${WRITE}\n}\nexport { handler as DELETE };\n`,
  });

  assert.equal(at(model, 'DELETE').sensitiveOperations.length, 1);
  assert.equal(at(model, 'DELETE').inferredAccess, 'public');
  assert.ok(
    model.findings.some((finding) => finding.ruleId === 'AUTH001'),
    'an unguarded re-exported write is still a finding',
  );
});

test('a guard inside a re-exported handler is found', (t) => {
  const model = project(t, {
    'app/api/t/route.ts':
      `async function handler() {\n  await requireAdmin();\n  ${WRITE}\n}\nexport { handler as DELETE };\n`,
  });

  assert.equal(at(model, 'DELETE').inferredAccess, 'admin');
  assert.deepEqual(model.findings, []);
});

test('a handler re-exported from another module keeps its guard', (t) => {
  // `export { deleteUser as DELETE } from "@/lib/handlers"` has no body in the
  // route file. Reading it as unguarded would be a false positive on a route
  // that is in fact protected.
  const model = project(t, {
    'lib/handlers.ts': `export async function deleteUser() {\n  await requireAdmin();\n  ${WRITE}\n}\n`,
    'app/api/t/route.ts': 'export { deleteUser as DELETE } from "@/lib/handlers";\n',
  });

  assert.equal(at(model, 'DELETE').inferredAccess, 'admin');
  assert.equal(at(model, 'DELETE').authSignals[0].name, 'requireAdmin');
});

test('a cross-module re-export with no guard is still reported as unguarded', (t) => {
  // The other direction has to hold too, or the fix would silence real findings.
  const model = project(t, {
    'lib/handlers.ts': `export async function deleteUser() {\n  ${WRITE}\n}\n`,
    'app/api/t/route.ts': 'export { deleteUser as DELETE } from "@/lib/handlers";\n',
  });

  assert.equal(at(model, 'DELETE').inferredAccess, 'public');
  assert.ok(model.findings.some((finding) => finding.ruleId === 'AUTH001'));
});

test('a guard behind a barrel module is followed', (t) => {
  // route -> barrel -> implementation. The barrel holds no body, so stopping
  // there reported a guarded handler as unguarded.
  const model = project(t, {
    'lib/impl.ts': `export async function impl() {\n  await requireAdmin();\n  ${WRITE}\n}\n`,
    'lib/barrel.ts': 'export { impl as mid } from "@/lib/impl";\n',
    'app/api/t/route.ts': 'export { mid as DELETE } from "@/lib/barrel";\n',
  });

  assert.equal(at(model, 'DELETE').inferredAccess, 'admin');
});

test('a cyclic re-export terminates', (t) => {
  // Two modules re-exporting each other must not hang the scan.
  const model = project(t, {
    'lib/x.ts': 'export { b as a } from "@/lib/y";\n',
    'lib/y.ts': 'export { a as b } from "@/lib/x";\n',
    'app/api/t/route.ts': 'export { a as DELETE } from "@/lib/x";\n',
  });

  assert.equal(at(model, 'DELETE').inferredAccess, 'public', 'no body was ever found');
});

test('an export name that is not an HTTP method is not a route', (t) => {
  const model = project(t, {
    'app/api/t/route.ts': 'async function helper() {}\nexport { helper as utils };\n',
  });

  assert.deepEqual(model.entryPoints, []);
});

test('a wildcard re-export does not invent a route', (t) => {
  // `export * from "./handlers"` names nothing, so which methods it exports
  // cannot be known without module resolution. Inventing them would be
  // fabricating entry points.
  const model = project(t, {
    'lib/h.ts': 'export async function GET() { return Response.json({}); }\n',
    'app/api/t/route.ts': 'export * from "@/lib/h";\n',
  });

  assert.deepEqual(model.entryPoints, []);
});

test('a type-only export is not a route', (t) => {
  const model = project(t, {
    'app/api/t/route.ts': 'type T = string;\nexport type { T as GET };\n',
  });

  assert.deepEqual(model.entryPoints, []);
});

test('a re-export of a name that does not exist does not crash', (t) => {
  const model = project(t, {
    'app/api/t/route.ts': 'export { nope as GET } from "@/lib/missing";\n',
  });

  assert.equal(model.entryPoints.length, 1, 'the export is real even if the target is not');
  assert.equal(at(model, 'GET').inferredAccess, 'public');
});

test('SvelteKit re-exports resolve the same way', (t) => {
  // The shape is an ES module feature, not a framework convention, so both
  // adapters share one implementation and must not drift apart.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'detent-rx-sk-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relative, source) => {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, source);
  };
  write('package.json', '{"devDependencies":{"@sveltejs/kit":"2.0.0"}}');
  write('src/lib/h.ts', `export async function del() {\n  await requireAdmin();\n  ${WRITE}\n}\n`);
  write('src/routes/api/t/+server.ts', 'export { del as DELETE } from "$lib/h";\n');

  const model = scanProject(root, 'sveltekit');
  assert.equal(model.entryPoints.length, 1);
  assert.equal(model.entryPoints[0].inferredAccess, 'admin', '$lib must resolve');
});

test('re-export discovery is deterministic', (t) => {
  const files = {
    'lib/handlers.ts': `export async function deleteUser() {\n  await requireAdmin();\n  ${WRITE}\n}\n`,
    'app/api/t/route.ts': 'export { deleteUser as DELETE, deleteUser as PUT } from "@/lib/handlers";\n',
  };
  const first = project(t, files);
  const second = project(t, files);

  assert.deepEqual(
    second.entryPoints.map((entry) => [entry.id, entry.inferredAccess]),
    first.entryPoints.map((entry) => [entry.id, entry.inferredAccess]),
  );
});

test('re-exporting does not turn a plain module into entry points', (t) => {
  // Only files named route.ts produce route handlers. A library that re-exports
  // something called GET is not attack surface.
  const model = project(t, {
    'lib/impl.ts': 'export async function GET() { return Response.json({}); }\n',
    'lib/index.ts': 'export { GET } from "@/lib/impl";\n',
  });

  assert.deepEqual(model.entryPoints, []);
});
