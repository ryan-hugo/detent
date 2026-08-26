# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`blame`.** Finds the commit where a route stopped being what it was. Walks
  first-parent history backwards, scanning each tree with the same scanner used
  everywhere else, and stops at the first posture that differs. Deliberately
  linear rather than bisecting: posture is not monotonic, so a binary search over
  `admin -> public -> admin -> public` returns a commit that is not the
  transition. A route absent from a tree is reported as `absent`, never as
  `public`. A reached commit limit or a shallow clone is reported as incomplete
  history rather than as "never changed".
- **`explain`.** Shows the evidence behind an access level: the call that
  established it and the chain of functions walked to reach it. The resolver
  already computed that chain and the scanner discarded it; `AuthSignal.via`
  now records it, so a route protected by a guard two calls away can be shown
  to be protected rather than asserted. Reports the reasoning the scanner
  already did — no new heuristics, no LLM, deterministic for a given tree.

- **SvelteKit adapter.** `+server.ts` method exports, `export const actions = {…}`
  form actions (one entry point per key), and server `load`. The client boundary
  follows SvelteKit's filename convention rather than a directive, and
  `$env/static/public` is treated the way `NEXT_PUBLIC_` is. The adapter is
  chosen from `package.json`, falling back to layout; `--framework` overrides it.
- **Two contract invariants that need no per-route declaration.**
  `siblings-agree-on-access` catches the one route in a group somebody forgot to
  guard; `no-public-entry-point` catches a route added after the contract was
  written.
- **`--markdown` for `diff` and `contract`.** Writes to `$GITHUB_STEP_SUMMARY`
  when present — a file the runner provides, so no token and no network call —
  and to stdout otherwise.
- **`triage`.** Reads SARIF from Semgrep or CodeQL and re-prioritizes it by
  reachability. A SQL injection on a public route and the same rule behind an
  admin guard are the same finding to a scanner and very different problems; only
  the publicly reachable ones fail the build.
- `npm run hygiene`, wired into `verify`: asserts the subprocess boundary
  (only `core/git.ts` may spawn), rejects suppressed type errors and leftover
  TODOs, and catches files corrupted by shell-escaping accidents.

- `init` — infers the project's own guard vocabulary from how the code is written
  and writes `detent.config.json` for review. Removes the chicken-and-egg problem
  where the tool needed configuration before it could be useful.
- Call resolution: a guard applied inside a helper one to three calls deep is now
  followed, so a thin delegating handler is no longer reported as unprotected.
  Bounded, cycle-safe, and never reads outside the project root.
- Signature verification (`constructEvent`, `timingSafeEqual`, `verifyWebhook`
  and friends) counts as authentication.

### Fixed

- `AUTH001` no longer fires on an unguarded entry point that performs no observed
  sensitive operation. On vercel/commerce that was all six of its entry points —
  anonymous cart actions that legitimately need no session.

### Changed

- On dub (720 entry points), findings dropped from 398 to 106 using a config the
  tool generated itself. On vercel/commerce and shadcn-ui/taxonomy, from 7
  findings to 0 — every one of which was a false positive.

## [0.1.0-alpha.0] — 2026-08-26

First public alpha. The Next.js App Router adapter is functional and the model,
diff, contract and graph commands all work, but detection is deliberately
conservative and the API is not yet stable.

### Added

- `inspect` — compile an Application Security Model from a Next.js App Router
  project: route handlers, `use server` actions, authorization signals,
  sensitive operations, client boundaries and environment exposure.
- `diff` — compare against a recorded snapshot or, with `--base <ref>`, against
  a git tree directly. Exits 1 on a high/critical regression.
- `contract` — check declared invariants in `detent.contract.json`.
- `graph` — render attack paths as a self-contained HTML page.
- `snapshot` — record a local baseline under `.detent/model.json`.
- `--html` reports for `inspect`, `diff`, `contract` and `graph`. No network
  requests, no scripts, no hosted UI.
- `detent.config.json` — map project-specific guard names to access semantics.

### Security

- Target code is parsed, never executed: `ts.createSourceFile` only, with no
  program construction, type checker or module resolution.
- The only subprocess is `git`, invoked through `execFile` with an argument
  array so a ref name cannot become a command.
- Reading history never mutates the working tree.

### Known limitations

- Guards applied through a helper one call deep are not followed, so a route
  protected inside a shared function reads as `public`.
- `middleware.ts` is not modelled.
- Re-exported route handlers (`export { handler as GET }`) are not discovered.
- Removed entry points are not reported by `diff`.
- Authorization detection is name-based; a guard this build does not recognize
  reads as absent. Use `detent.config.json` to teach it your vocabulary.
