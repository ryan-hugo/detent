# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
