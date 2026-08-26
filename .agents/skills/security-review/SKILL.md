---
name: security-review
description: Review changes to Detent itself for unsafe target-code execution, misleading findings, path/file handling risks, and regression in local-first guarantees.
---

# Security review workflow

Review the patch as a security tool maintainer, not as a generic style reviewer.

Check, in order:

1. **Target isolation** — no `import()`, `require()`, child process, package lifecycle, framework build, or arbitrary command executes target repository code.
2. **Filesystem boundaries** — scanning stays under the requested root and does not follow dangerous output/cache paths by accident.
3. **Evidence integrity** — findings point to actual parsed evidence and do not claim exploitability that the detector cannot establish.
4. **False-positive pressure** — new heuristics have a safe counterexample or an explicit limitation.
5. **Determinism** — same source tree produces semantically equivalent output; timestamps may differ but findings must not.
6. **Privacy/local-first** — no telemetry, uploads, or network calls were added silently.
7. **Regression harness** — `npm run verify` passes.

Output only actionable issues, ordered by severity. If no material issue is found, say so explicitly.
