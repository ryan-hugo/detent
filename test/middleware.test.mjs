import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { matcherToRegExp, barrierApplies } from '../dist/core/middleware.js';
import { scanNextProject } from '../dist/adapters/nextjs/scan.js';

/** Builds a throwaway Next.js project and scans it. */
function project(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'detent-mw-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, source] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, source);
  }
  fs.writeFileSync(path.join(root, 'package.json'), '{"dependencies":{"next":"15.0.0"}}');
  return scanNextProject(root);
}

const GUARD = 'export async function requireAdmin() { return true; }\n';
const ROUTE = `export async function DELETE() {\n  await db.users.delete({ where: {} });\n}\n`;

const middleware = (matcher, guard = 'requireAdmin') =>
  `import { ${guard} } from "@/lib/auth";\n` +
  `export async function middleware(request) {\n  await ${guard}();\n}\n` +
  (matcher === null ? '' : `export const config = { matcher: ${matcher} };\n`);

const access = (model, route) =>
  model.entryPoints.find((entry) => entry.route === route)?.inferredAccess;

// --- matcher translation, against the rules Next.js documents -----------------

test('a named parameter matches one segment, not several', () => {
  const expression = matcherToRegExp('/about/:path');
  assert.equal(expression.test('/about/a'), true);
  assert.equal(expression.test('/about/a/c'), false);
});

test('* is zero or more segments and + is one or more', () => {
  assert.equal(matcherToRegExp('/about/:path*').test('/about'), true);
  assert.equal(matcherToRegExp('/about/:path*').test('/about/a/b/c'), true);
  assert.equal(matcherToRegExp('/about/:path+').test('/about'), false);
  assert.equal(matcherToRegExp('/about/:path+').test('/about/a'), true);
});

test('a matcher is anchored, so a prefix does not match a longer segment', () => {
  // `/about` must not match `/aboutus`, and must not match `/blog/about`.
  const expression = matcherToRegExp('/about');
  assert.equal(expression.test('/about'), true);
  assert.equal(expression.test('/aboutus'), false);
  assert.equal(expression.test('/blog/about'), false);
});

test('a parenthesised group is a regular expression, not a glob', () => {
  // The case that makes glob matching dangerous: this pattern excludes /api,
  // and reading it as a glob would claim the middleware guards /api/admin.
  const expression = matcherToRegExp('/((?!api|_next/static).*)');
  assert.equal(expression.test('/api/admin/users'), false, 'the lookahead excludes /api');
  assert.equal(expression.test('/dashboard'), true);
});

test('a matcher that does not start with / is refused rather than guessed at', () => {
  assert.equal(matcherToRegExp('about'), undefined);
});

test('an unbalanced group is refused rather than half-parsed', () => {
  assert.equal(matcherToRegExp('/((?!api.*'), undefined);
});

test('a catastrophically backtracking matcher is refused, not compiled', () => {
  // A matcher comes from whatever repository is being scanned, so it is
  // untrusted input. `/((a+)+)$` compiles to a regex that hangs the process on
  // a 30-character non-matching string — a denial of service against the
  // machine running the analysis. Found by attacking the matcher.
  for (const evil of ['/((a+)+)$', '/(([a-z]+)*)$', '/((a{1,9})+)x']) {
    assert.equal(matcherToRegExp(evil), undefined, `${evil} must be refused`);
  }
});

test('refusing evil patterns does not refuse real ones', () => {
  // The bound is worthless if it also rejects the matchers projects actually
  // write, so both halves are asserted together.
  for (const real of ['/api/:path*', '/((?!api|_next/static).*)', '/about/(.*)', '/dashboard/:path+']) {
    assert.ok(matcherToRegExp(real), `${real} must still work`);
  }
});

test('matching a hostile matcher completes promptly', () => {
  const started = Date.now();
  const expression = matcherToRegExp('/((a+)+)$');
  if (expression) expression.test(`/${'a'.repeat(32)}X`);
  assert.ok(Date.now() - started < 1000, 'a matcher must never hang the scan');
});

test('an absurdly long matcher is refused', () => {
  assert.equal(matcherToRegExp(`/${'a'.repeat(500)}`), undefined);
});

test('a conditional barrier never claims to protect anything', () => {
  const barrier = {
    file: 'middleware.ts',
    access: 'admin',
    guards: [],
    matchers: ['/api/:path*'],
    appliesToAll: false,
    conditional: true,
    location: { file: 'middleware.ts', line: 1 },
  };
  // The matcher matches, but applicability depends on a request header that
  // does not exist at analysis time.
  assert.equal(barrierApplies(barrier, '/api/admin'), false);
});

// --- the gap this closes ------------------------------------------------------

test('a route guarded only by middleware is not reported as public', (t) => {
  const model = project(t, {
    'lib/auth.ts': GUARD,
    'middleware.ts': middleware('["/api/admin/:path*"]'),
    'app/api/admin/users/route.ts': ROUTE,
  });

  assert.equal(access(model, '/api/admin/users'), 'admin');
  assert.deepEqual(model.findings, [], 'a protected route produces no finding');
});

test('a route the matcher does not name stays public', (t) => {
  const model = project(t, {
    'lib/auth.ts': GUARD,
    'middleware.ts': middleware('["/api/admin/:path*"]'),
    'app/api/admin/users/route.ts': ROUTE,
    'app/api/public/info/route.ts': 'export async function GET() { return Response.json({}); }\n',
  });

  assert.equal(access(model, '/api/public/info'), 'public', 'crediting every route would be worse than the gap');
});

test('middleware with no matcher applies to every route', (t) => {
  // Next.js runs a middleware without `config` on every request.
  const model = project(t, {
    'lib/auth.ts': GUARD,
    'middleware.ts': middleware(null),
    'app/api/anything/route.ts': ROUTE,
  });

  assert.equal(access(model, '/api/anything'), 'admin');
  assert.equal(model.barriers[0].appliesToAll, true);
});

test('a negative-lookahead matcher does not protect the paths it excludes', (t) => {
  const model = project(t, {
    'lib/auth.ts': GUARD,
    'middleware.ts': middleware('["/((?!api).*)"]'),
    'app/api/admin/users/route.ts': ROUTE,
  });

  assert.equal(access(model, '/api/admin/users'), 'public', 'the matcher explicitly excludes /api');
});

test('a dynamic matcher is conditional and grants nothing', (t) => {
  // Next.js ignores non-constant matchers; inferring one would invent a barrier.
  const model = project(t, {
    'lib/auth.ts': GUARD,
    'middleware.ts':
      'import { requireAdmin } from "@/lib/auth";\n' +
      'const paths = ["/api/:path*"];\n' +
      'export async function middleware(request) { await requireAdmin(); }\n' +
      'export const config = { matcher: paths };\n',
    'app/api/admin/users/route.ts': ROUTE,
  });

  assert.equal(access(model, '/api/admin/users'), 'public');
  assert.equal(model.barriers[0].conditional, true);
});

test('a matcher gated on request conditions is conditional', (t) => {
  const model = project(t, {
    'lib/auth.ts': GUARD,
    'middleware.ts':
      'import { requireAdmin } from "@/lib/auth";\n' +
      'export async function middleware(request) { await requireAdmin(); }\n' +
      'export const config = { matcher: [{ source: "/api/:path*", has: [{ type: "header", key: "x-token" }] }] };\n',
    'app/api/admin/users/route.ts': ROUTE,
  });

  assert.equal(access(model, '/api/admin/users'), 'public', 'applicability depends on a header we cannot read');
  assert.equal(model.barriers[0].conditional, true);
});

test('middleware with no guard inside it is not a barrier', (t) => {
  const model = project(t, {
    'middleware.ts':
      'export async function middleware(request) { console.log(request.url); }\n' +
      'export const config = { matcher: ["/api/:path*"] };\n',
    'app/api/admin/users/route.ts': ROUTE,
  });

  assert.deepEqual(model.barriers, [], 'logging is not authorization');
  assert.equal(access(model, '/api/admin/users'), 'public');
});

test('proxy.ts is recognized, since Next.js 16 renamed middleware to proxy', (t) => {
  const model = project(t, {
    'lib/auth.ts': GUARD,
    'proxy.ts':
      'import { requireAdmin } from "@/lib/auth";\n' +
      'export async function proxy(request) { await requireAdmin(); }\n' +
      'export const config = { matcher: ["/api/:path*"] };\n',
    'app/api/admin/users/route.ts': ROUTE,
  });

  assert.equal(access(model, '/api/admin/users'), 'admin');
});

test('an anonymous default export is still middleware', (t) => {
  // `export default async function (request) {…}` is legal and has no name to
  // key on. Skipping it would drop a real barrier and report a guarded route
  // as public.
  const model = project(t, {
    'lib/auth.ts': GUARD,
    'middleware.ts':
      'import { requireAdmin } from "@/lib/auth";\n' +
      'export default async function (request) { await requireAdmin(); }\n' +
      'export const config = { matcher: ["/api/:path*"] };\n',
    'app/api/admin/users/route.ts': ROUTE,
  });

  assert.equal(access(model, '/api/admin/users'), 'admin');
});

test('middleware exported by reference is found', (t) => {
  const model = project(t, {
    'lib/auth.ts': GUARD,
    'middleware.ts':
      'import { requireAdmin } from "@/lib/auth";\n' +
      'const handler = async (request) => { await requireAdmin(); };\n' +
      'export default handler;\n' +
      'export const config = { matcher: ["/api/:path*"] };\n',
    'app/api/admin/users/route.ts': ROUTE,
  });

  assert.equal(access(model, '/api/admin/users'), 'admin');
});

test('a matcher given as a bare string works like a single-element array', (t) => {
  const model = project(t, {
    'lib/auth.ts': GUARD,
    'middleware.ts':
      'import { requireAdmin } from "@/lib/auth";\n' +
      'export async function middleware(request) { await requireAdmin(); }\n' +
      'export const config = { matcher: "/api/:path*" };\n',
    'app/api/admin/users/route.ts': ROUTE,
  });

  assert.equal(access(model, '/api/admin/users'), 'admin');
});

test('a wrapped default export is middleware', (t) => {
  // The shape shadcn-ui/taxonomy actually ships:
  // `export default withAuth(async function middleware(req) {…})`.
  // Found by scanning the real repository, where it produced no barrier at all.
  const model = project(t, {
    'lib/auth.ts': GUARD,
    'middleware.ts':
      'import { withAuth } from "next-auth/middleware";\n' +
      'export default withAuth(async function middleware(req) {\n  return null;\n});\n' +
      'export const config = { matcher: ["/dashboard/:path*"] };\n',
    'app/dashboard/api/x/route.ts': ROUTE,
  });

  assert.equal(model.barriers.length, 1, 'the wrapper is the evidence');
  assert.equal(model.barriers[0].guards[0].name, 'withAuth');
});

test('a re-exported middleware is not credited as a barrier', (t) => {
  // `export { auth as middleware } from "auth"` — the next-auth v5 shape. The
  // guard lives in a module we do not follow, so claiming protection here would
  // be asserting something unproven. Under-reporting is the safe direction.
  const model = project(t, {
    'middleware.ts':
      'export { auth as middleware } from "auth";\n' +
      'export const config = { matcher: ["/api/:path*"] };\n',
    'app/api/admin/users/route.ts': ROUTE,
  });

  assert.deepEqual(model.barriers, []);
  assert.equal(access(model, '/api/admin/users'), 'public');
});

test('middleware is a barrier, never an entry point', (t) => {
  const model = project(t, {
    'lib/auth.ts': GUARD,
    'middleware.ts': middleware('["/api/:path*"]'),
    'app/api/admin/users/route.ts': ROUTE,
  });

  assert.equal(model.entryPoints.length, 1, 'the middleware itself is not attack surface');
  assert.equal(model.entryPoints[0].route, '/api/admin/users');
});

test('a server action is not credited with middleware protection', (t) => {
  // Next.js documents that Server Functions are POSTs to the route they are
  // used on, and warns that a matcher change can silently remove that coverage.
  const model = project(t, {
    'lib/auth.ts': GUARD,
    'middleware.ts': middleware(null),
    'app/actions/billing.ts':
      '"use server";\nexport async function refund() {\n  await db.payments.delete({ where: {} });\n}\n',
  });

  const action = model.entryPoints.find((entry) => entry.kind === 'server-action');
  assert.equal(action.inferredAccess, 'public', 'the framework says not to rely on middleware here');
});

test('middleware evidence is marked as coming from middleware', (t) => {
  const model = project(t, {
    'lib/auth.ts': GUARD,
    'middleware.ts': middleware('["/api/:path*"]'),
    'app/api/admin/users/route.ts': ROUTE,
  });

  const signal = model.entryPoints[0].authSignals[0];
  assert.equal(signal.source, 'middleware', 'the guard is in another file, and that has to be visible');
});

test('authorization in middleware does not trip the late-guard rule', (t) => {
  // AUTH003 compares line numbers, but middleware runs before the handler is
  // entered and its line refers to a different file entirely.
  const model = project(t, {
    'lib/auth.ts': GUARD,
    'middleware.ts':
      'import { requireAdmin } from "@/lib/auth";\n\n\n\n\n' +
      'export async function middleware(request) { await requireAdmin(); }\n' +
      'export const config = { matcher: ["/api/:path*"] };\n',
    'app/api/admin/users/route.ts': ROUTE,
  });

  assert.equal(
    model.findings.filter((finding) => finding.ruleId === 'AUTH003').length,
    0,
    'a guard that runs first must not be reported as running last',
  );
});

test('the result does not depend on which file is scanned first', (t) => {
  // Middleware may be walked before or after the routes it covers.
  const files = {
    'lib/auth.ts': GUARD,
    'middleware.ts': middleware('["/api/:path*"]'),
    'app/api/admin/users/route.ts': ROUTE,
    'zzz/api/late/route.ts': ROUTE,
  };
  const first = project(t, files);
  const second = project(t, files);

  assert.equal(access(first, '/api/admin/users'), 'admin');
  assert.deepEqual(
    second.entryPoints.map((entry) => [entry.route, entry.inferredAccess]),
    first.entryPoints.map((entry) => [entry.route, entry.inferredAccess]),
  );
});

test('middleware under src/ is found', (t) => {
  // Next.js honours the file at the root or in src/. The path is compared with
  // forward slashes, which is what the walker normalizes to on every platform.
  const model = project(t, {
    'src/lib/auth.ts': GUARD,
    'src/middleware.ts':
      'import { requireAdmin } from "@/lib/auth";\n' +
      'export async function middleware(request) { await requireAdmin(); }\n' +
      'export const config = { matcher: ["/api/admin/:path*"] };\n',
    'src/app/api/admin/x/route.ts': ROUTE,
  });

  assert.equal(model.barriers.length, 1);
  assert.equal(access(model, '/api/admin/x'), 'admin');
});

test('a nested module named middleware.ts is not treated as a barrier', (t) => {
  // Next.js only honours the file at the project root or in src/.
  const model = project(t, {
    'lib/auth.ts': GUARD,
    'app/lib/middleware.ts':
      'import { requireAdmin } from "@/lib/auth";\n' +
      'export async function middleware(request) { await requireAdmin(); }\n' +
      'export const config = { matcher: ["/api/:path*"] };\n',
    'app/api/admin/users/route.ts': ROUTE,
  });

  assert.deepEqual(model.barriers, [], 'only the root file is middleware');
  assert.equal(access(model, '/api/admin/users'), 'public');
});
