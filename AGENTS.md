# Detent — agent map

This repository is intentionally optimized for human + coding-agent collaboration.
Keep this file short. The source of truth lives under `docs/`.

## Start here

1. Product intent: `docs/product/vision.md`
2. Architecture: `docs/design/architecture.md`
3. Security model: `docs/design/application-security-model.md`
4. Agent harness: `docs/design/agent-harness.md`
5. Evals: `docs/evals/README.md`
6. Decisions: `docs/decisions/`
7. 2026 agentic-development baseline: `docs/research/agentic-development-2026-08.md`
8. Current roadmap: `docs/roadmap/phase-0.md`

## Commands

- Install: `npm install`
- Typecheck: `npm run typecheck`
- Tests: `npm test`
- Evals: `npm run evals`
- Full verification: `npm run verify`
- Fixture demo: `npm run inspect:fixture`

## Non-negotiable engineering rules

- Core analysis is deterministic. An LLM must never be required to produce a security verdict.
- Never execute code from a target repository. Parse source/configuration only.
- Default to local/offline operation; new network dependencies require an ADR.
- Findings require concrete evidence: file, line, rule ID, and why the signal fired.
- Prefer `unknown`/no finding over fabricated certainty.
- Every detector change needs a fixture and an eval expectation.
- Keep adapters isolated from the core application-security model.
- Do not broaden supported frameworks accidentally; Next.js + TypeScript is the v0 scope.
- Before finishing code changes, run `npm run verify`.

## Agent workflow

For implementation work, read the relevant design doc first. Use project skills when applicable:
- `.agents/skills/add-detector/SKILL.md`
- `.agents/skills/security-review/SKILL.md`

When a task can be safely parallelized, delegate bounded research/review/test work to subagents. Avoid multiple agents editing the same files concurrently.
