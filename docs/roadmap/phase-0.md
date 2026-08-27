# Phase 0 — prove the Application Security Model

## Goal

Demonstrate that a local scanner can derive a useful, stable security model from real Next.js repositories with low noise.

## Implemented in the bootstrap

- Route Handler discovery.
- `use server` module export discovery.
- Basic authorization-signal extraction.
- Basic sensitive-operation extraction.
- `use client` boundary discovery.
- Environment exposure checks.
- Local model snapshot.
- Semantic access-broadening diff.
- Static, self-contained HTML reporter for model and diff (`--html`).
- CI-friendly non-zero exit on high/critical regressions.
- Agent harness, skills, specialist agent profiles, tests, and evals.
- AST-based extraction via the TypeScript parser (P0.1, partial).
- Project-local auth/sensitive vocabulary via `detent.config.json` (P0.2).
- Git-native baseline via `diff --base <ref>` (P0.3).
- Security Contract v0 via `detent contract` (P0.4).
- Attack-path graph via `detent graph` (P0.5).
- AUTH003: authorization that runs after the operation it should protect.

## Next milestones

### P0.1 — parser reliability

Done:

- ~~Replace lexical function extraction with the TypeScript Compiler API.~~ `src/adapters/nextjs/extract.ts` parses with `ts.createSourceFile`. Parser only — no program, no type checker, no module resolution — so target code is still never executed and no import is ever followed.
- ~~Detect function-level `use server`, not only module-level directives.~~
- ~~Add negative fixtures for strings/comments that resemble calls.~~
- ~~Discover wrapped handlers such as `export const DELETE = withAdmin(...)`.~~

Done (continued):

- ~~Model `middleware.ts` and its matcher, so a route guarded by middleware stops
  reading as `public`.~~ Closed 2026-08-26; see "Gap 4 closed" below.

- ~~Support re-exported Route Handlers conservatively (`export { handler as GET }`).~~
  Closed 2026-08-26; see "Re-exported handlers" below.

**P0.1 is complete.** Every measured gap is closed.

Outstanding (not P0.1, and deliberately not attempted):

- `export * from "./handlers"` names nothing, so which methods it re-exports
  cannot be known without real module resolution. Inventing them would be
  fabricating entry points, so a wildcard produces none.
- `export { auth as middleware } from "auth"` — the next-auth v5 shape — points
  at a package, not a project file. It is recorded as no barrier rather than an
  assumed one.

#### Measured gaps (2026-08-25)

These are reproducible today and are the reason P0.1 outranks every other milestone.
Each one is a wrong answer, not a missing feature.

| # | Pattern | Current result | Correct result |
|---|---------|----------------|----------------|
| 1 | `requireAdmin()` inside a string literal; `auth()` inside a comment | ~~`admin`~~ **fixed** | `public` |
| 2 | `'use server'` in one function body, module has no directive | ~~every export~~ **fixed** | only that function |
| 3 | `export const DELETE = withAdmin(async () => {…})` | ~~not discovered~~ **fixed** | route handler, guard `withAdmin` |
| 4 | `middleware.ts` matching `/api/:path*` | ~~not modelled~~ **fixed** | guard applied to matched routes |
| 5 | `export const POST = (async () => {…},)` | ~~not discovered~~ **fixed** | route handler, no guard |

Gap 1 was the dangerous one: it invented an authorization barrier out of dead text,
the exact failure mode the evidence rule in `AGENTS.md` forbids. Gap 2 inflated the
entry-point count with functions that are not reachable. Gaps 3 and 4 are silent
under-reporting: a genuinely guarded route reads as absent, and a route guarded by
middleware reads as `public`.

Gaps 1, 2 and 3 were closed by P0.1. They are locked by `test/parser-gaps.test.mjs`
and by the `next-dead-text`, `next-inline-action` and `next-wrapped-handler` eval
fixtures. Gap 4 needed a new entity in the model rather than a better parser, and
is covered below.

#### Gap 4 closed (2026-08-26)

A route guarded only by middleware read as `public` and produced two HIGH
findings that were both wrong. `MiddlewareBarrier` is now a first-class entity in
the model: a barrier that guards by path match rather than by being called.

What the implementation is careful about, and why:

- **Matchers are path-to-regexp, not globs.** `/((?!api|_next/static).*)` — the
  shape nearly every real project uses — *excludes* `/api`. Glob matching would
  have concluded the opposite and claimed protection for exactly the routes the
  matcher exempts. All the documented rules are implemented and tested: `:path`
  is one segment, `*` is zero-or-more, `+` is one-or-more, parenthesised groups
  are real regular expressions, and patterns are anchored.
- **`proxy.ts` as well as `middleware.ts`.** Next.js 16 renamed the convention.
  Recognising only the old name would silently lose the barrier after a codemod.
- **Server Actions are never credited.** Next.js documents that Server Functions
  are POSTs to the route they are used on, and warns that a matcher change can
  silently remove that coverage. Crediting them would assert what the framework
  itself says not to rely on.
- **Unprovable barriers grant nothing.** A dynamic matcher (which Next.js itself
  ignores), a matcher gated on `has`/`missing` request conditions, and a
  middleware whose body contains no guard are all recorded without raising any
  route's access level.
- **AUTH003 excludes middleware signals.** That rule compares line numbers, but
  middleware runs before the handler is entered and its line refers to another
  file. Left unfixed it reported a guard that genuinely runs first as running
  last — a false positive introduced by the fix itself, caught by testing it.

Two defects were found by attacking the feature rather than exercising it:

1. **A catastrophically backtracking matcher hung the scan.** A matcher is
   untrusted input — it comes from the repository being scanned — and
   `/((a+)+)$` compiles to a regex that never returns on a 30-character string.
   That is a denial of service against the machine running the analysis.
   Nested quantifiers are now refused before compilation.
2. **The real-world shape was not detected at all.** shadcn-ui/taxonomy ships
   `export default withAuth(async function middleware(req) {…})`, and the first
   implementation found no barrier in it. Wrapped and anonymous default exports
   are now extracted, which also fixed `export default handler`.

Measured on real repositories: taxonomy detects `withAuth` over its four
documented matcher paths and correctly credits none of its `/api/*` routes,
which the matcher does not cover. Findings stayed at 0 on both taxonomy and
next-auth-example — the fix removes false positives without adding any.

Locked by `test/middleware.test.mjs` (31 tests) and the `next-middleware` eval
fixture, which asserts both halves: the matched route is protected, and the
route the matcher does not name is not.

#### Re-exported handlers (2026-08-26)

A route file written as `export { handler as GET }` exported nothing the
extractor could see, so the route did not appear in the model **at all** — worse
than a wrong label, because an unguarded route was not there to be reported.
Measured before the fix: a project with two such routes produced `entryPoints: 0`.

What is handled, and what is deliberately not:

- **`export { handler as GET, handler as DELETE }`** — one local function under
  several method names is several entry points, each analysed with that
  function's body.
- **`export { deleteUser as DELETE } from "@/lib/handlers"`** — no body in the
  route file. The export is treated as a call to the imported name, so the
  resolver follows it and a guard in the implementation counts as evidence one
  hop deeper. Without this the route read as `public` while being genuinely
  protected — a false positive introduced by the discovery fix itself.
- **Barrel modules.** `route -> barrel -> implementation` is followed, because a
  barrel holds no body and stopping there reported a guarded handler as
  unguarded. Cyclic re-exports terminate on the resolver's existing `seen` set.
- **`export * from "./handlers"`** produces nothing. It names no exports, so
  which methods it forwards cannot be known without real module resolution, and
  guessing would fabricate entry points.
- **Type-only exports and non-method names** produce nothing.

The seeding logic lives in `src/adapters/shared.ts` and is used by both
adapters: a re-export is an ES module feature, not a framework convention, and
duplicating it would let the two drift. Fixing it in one place also revealed
that SvelteKit's `$lib` alias was never resolved, so guards behind it were
invisible to the second adapter — now handled alongside `@/`.

Measured on real repositories: nextauthjs/next-auth-example ships
`export { handler as GET, handler as POST }` in `app/[...proxy]/route.tsx`.
Entry points went from 1 to 3 — two real routes recovered, both correctly
`authenticated` from the `auth()` call inside the shared handler. Findings
stayed at 0 there and on taxonomy: the fix recovers hidden attack surface
without adding noise.

Locked by `test/reexport.test.mjs` (15 tests) and the `next-reexport` eval
fixture.

### P0.2 — configurable auth vocabulary — done

`detent.config.json` at the project root maps project-specific names to security
semantics. Parsed as JSON, never imported, so loading it cannot execute target code.

- `guards`: name → access level. Beats the built-in heuristics.
- `notGuards`: names that must never count as evidence. Beats everything, including `guards`.
- `sensitive`: name → operation category.

Names resolve against the full dotted callee or its last segment, so `exigirGestor`
also matches `guards.exigirGestor()`. Invalid mappings raise a `ConfigError` and
exit 2 rather than being dropped: a silently ignored typo would read as "no guard",
which is the unsafe direction to fail in.

Covered by `test/config.test.mjs` and the `next-custom-vocab` eval fixture.

Outstanding: no way yet to express *where* a guard applies (a guard valid for one
route but not another). That is Security Contract territory — see P0.4.

### P0.3 — Git-native diff — done

`detent diff --base <ref>` builds the baseline model from that ref's tree, so no
snapshot file is needed. `--baseline PATH` still works for projects outside git.

How it reads history:

- `git ls-tree` + `git show` into a temporary directory, removed afterwards.
- The working tree is never touched — no checkout, no stash, no index change.
- Only `git` itself is executed, via `execFile` with an argument array. A branch
  name cannot inject a command, which `test/git.test.mjs` asserts directly.
- `.json` travels with the tree, so the baseline is evaluated with the
  `detent.config.json` of *that commit*. Renaming a guard in the same PR is
  therefore compared honestly.

Nested projects work: run against `apps/web` in a monorepo and paths resolve
relative to that directory, not the repository root. This was a real bug during
implementation (`git show` needs `<sha>:./<path> --` when run with `-C`), and is
locked by a monorepo test.

Outstanding: `--base` compares the ref against the *working tree*. Comparing two
refs (`--base main --head release`) is not supported yet.

### P0.4 — Security Contract v0 — done

`detent contract` checks `detent.contract.json` against the model. All three v0
invariants are implemented:

- `entry-point-requires-access` — the entry point must sit at or above a level on
  the access lattice. `match` supports `*`.
- `env-is-server-only` — the variable must not be `NEXT_PUBLIC_`-prefixed nor read
  from a `use client` module.
- `sensitive-operation-requires-guard` — any entry point performing that operation
  category must carry an authorization signal.

Every breach reports `expected` against `actual`, so it reads as a decision the
team made rather than an opinion the tool holds. A breach exits 1. Malformed
requirements raise `ContractError` and exit 2 instead of being skipped.

Why this is separate from findings: a finding is heuristic and arguable, and its
severity is the tool's judgement. A requirement is the team's, so it does not need
a severity — it either holds or it does not.

Covered by `test/contract.test.mjs` and a contract eval on `next-basic`.

Outstanding: requirements cannot yet be scoped to a branch or environment, and
there is no `--explain` that shows which evidence satisfied a passing requirement.

### P0.5 — local graph — done

`detent graph --html PATH` renders attack paths: one chain per entry point, drawn
as `origin → barrier → entry point → effect`. Paths that reach a sensitive
operation with no barrier sort first, since those are the ones worth reading.

The chain is the point. The tables in `inspect` answer "what exists"; the graph
answers "what can be reached, and what stands in the way". A missing guard is
drawn as a dashed `no barrier` node rather than an omission, so the gap is visible
rather than inferred from absence.

Still a static, self-contained page: no hosted UI, no network, no script tags.

Outstanding: paths are per-entry-point and do not yet chain through shared
helpers, so a guard applied one call deep is not drawn. Middleware now raises a
matched route’s access level, but the barrier itself is not drawn as a node yet.

### Go criterion met (2026-08-26)

Three changes, in the order their absence hurt most:

1. **Call resolution.** A handler that delegates carries no evidence of its own;
   the guard is one call deeper. Following it (bounded to depth 3, cycle-safe,
   never reading outside the project root) is what separates a tool that fires on
   every thin handler from one that answers the real question.
2. **Signature verification is authentication.** `constructEvent` throws on a bad
   signature and is stronger than a session lookup. Missing it reported real
   webhooks as unprotected.
3. **`detent init`.** Requiring a config before the tool is useful was the
   adoption blocker: a team had to understand the tool before it could help them.
   Inference reads how the project is written and proposes the vocabulary; the
   team reviews and owns it. Nothing is applied silently.

Measured after:

| Repository | Findings before | Findings after | Guards detected |
|---|---|---|---|
| vercel/commerce | 6 | **0** | n/a (anonymous by design) |
| shadcn-ui/taxonomy | 1 | **0** | 7/8 |
| dub | 398 | **106** | 349/720, config self-generated |

Every finding removed was a false positive, verified by reading the source. No
true positive was lost: the fixture suite and eval expectations are unchanged.

**The go criterion is now met.** A second framework adapter is defensible.

## Go/no-go criterion

Do not add another framework until at least three real Next.js repositories produce useful output with an acceptable false-positive rate and the model can explain a meaningful PR security diff.

### First real-repository run (2026-08-26)

Three repositories, cloned and scanned as-is:

| Repository | Files | Entry points | Guards detected | Findings |
|---|---|---|---|---|
| vercel/commerce | 69 | 6 | 0 | 6 |
| shadcn-ui/taxonomy | 129 | 8 | 6 | 1 |
| dub (monorepo) | 4210 | 720 | 338 | 272 |

What it got right: taxonomy's own guards were recognized without configuration,
and dub's wrappers (`withWorkspace`, `withAdmin`, `withSession`) were recognized
after three lines of `detent.config.json` — which is exactly the case P0.2 exists
for. `diff --base` detected a removed wrapper on the real monorepo as
`authenticated -> public`.

Four defects the fixtures never surfaced, all now fixed and locked by tests:

1. **Prototype pollution in the vocabulary lookup.** `searchParams.toString()`
   resolved `guards["toString"]` through `Object.prototype` and returned a
   function, which read as truthy evidence of a barrier. Lookup tables are now
   `Object.create(null)`.
2. **Substring matching invented guards.** `/auth/i` matched `oAuthAppSchema.parse`
   (a Zod validator) and `/session/i` matched
   `stripe.billingPortal.sessions.create` (opening a payment session). Matching is
   now word-boundary aware.
3. **Grouping parens hid a handler.** `export const POST = (async () => {…},)`
   parses as a comma operator inside a parenthesized expression, so the entry
   point vanished entirely — the silent kind of failure. Recorded as gap 5.
4. **One `git show` per file did not scale.** dub is ~4200 scannable files, and
   `diff --base` timed out past three minutes. Blobs are now read through a single
   `git cat-file --batch`: 12s, a >15x improvement.

Known and accepted: commerce reports 6/6 because its cart actions are
intentionally anonymous, and `/api/revalidate` validates a Shopify secret one call
deep inside `revalidate(req)` — the helper-chaining limitation recorded in P0.5.
That, not the rule, is what needs work before the false-positive rate on
commerce-shaped code is acceptable.

Verdict: the model is useful on real code, but **the go criterion is not met yet**
— helper-chained guards must be followed before a second framework is worth
starting.

**Correction (same day).** The commerce noise was misdiagnosed above as a
helper-chaining problem. It was the rule: AUTH001 fired on `kind === "server-action"`
or a mutating method *without requiring an observed sensitive operation*, so every
unguarded action was reported whether or not it touched anything. Narrowing it to
require observed evidence takes commerce from 6 findings to 0, costs nothing on any
fixture, and leaves taxonomy's one true positive intact. Helper chaining is still
missing, but it was not what produced that noise.

### Hardening pass (2026-08-26)

Fuzzing the extractor with 12 degenerate inputs — empty files, invalid TypeScript,
unbalanced comments, 5000-character identifiers, 200-level nesting, BOM/CRLF, null
bytes, binary content named `.ts` — produced no crash and no invented evidence.

Two further defects were found by attacking the tool rather than exercising it:

**A guard that never protects still counted as one.** Five adversarial shapes all
reported `admin` with zero findings: a guard inside `if (false)`, a guard called
after the sensitive operation, a guard inside `catch`, a guard without `await`, and
a guard whose result is discarded. Position is decidable from evidence already in
the model, so `AUTH003` now fires when the earliest authorization signal sits below
the first sensitive operation. It found zero false positives across all three real
repositories.

The remaining shapes — dead branches, missing `await`, ignored results — need
control- and data-flow analysis, not position, and are deliberately not attempted.
A name-matched guard is still only evidence that a call exists.

**The walker followed directory links.** A link pointing at an ancestor made the
scan descend until the filesystem refused, inventing one phantom route per level.
Directory symlinks are now skipped outright (which also prevents scanning outside
the requested root) with a depth ceiling behind it. On Windows the path limit
masked the cycle; the guard matters on Linux and macOS, where it would not.

Also verified: `snapshot` → `diff` round-trips byte-identically; `diff` is
identity-stable, reports weakening but never tightening, and never reports a
removal as an addition; `inspect`, `contract` and `graph` agree on entry-point and
finding counts for the same model; and no temporary path from `--base` leaks into
JSON or HTML output.

One limitation is now asserted rather than assumed: **removed entry points are not
reported**. Deleting a route shrinks the attack surface, but a route deleted and
re-added without a guard currently shows only as an addition.
