# Product vision

## Working description

Detent is a local-first compiler for an application's security model.
It answers a developer-oriented question:

> What security-relevant behavior exists in this application, and what did my change alter?

The initial target is Next.js App Router + TypeScript.

## Product thesis

Traditional scanners mostly answer whether known vulnerability patterns exist. Detent instead builds a compact model of application entry points, trust boundaries, authorization signals, sensitive operations, environment exposure, and later database/integration boundaries.

From the same model we can support three user experiences without running a hosted backend:

1. `inspect` — build the current application security model.
2. `diff` — explain security-impacting changes relative to a baseline.
3. `contract` — compare implementation against explicit security invariants (future milestone).
4. `graph` — render attack-path/security architecture locally (future milestone).

## Constraints

- No mandatory SaaS.
- No user account required.
- No cloud scanner required.
- No paid LLM/API required.
- Target project code must not be executed.
- Useful in local development and CI.

## Initial success criterion

A developer should be able to run one command in a Next.js repository and receive a deterministic list of application entry points plus a small number of evidence-backed security findings.
