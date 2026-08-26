# Agent harness

## Why this repository has an explicit harness

Coding agents in 2026 perform best when the repository contains durable context, deterministic tools, fast feedback, and scoped specialist workflows. We optimize the repository itself rather than relying on one long prompt.

## Context hierarchy

- `AGENTS.md`: short map and universal invariants.
- `docs/`: source of truth for product and architecture.
- `.github/instructions/`: path-scoped coding instructions.
- `.agents/skills/`: repeatable workflows using the open Agent Skills format.
- `.github/agents/`: specialist agent profiles for hosts that support custom/subagents.

## Deterministic feedback loop

Agents should iterate through:

```text
understand -> edit -> typecheck -> tests -> evals -> review diff
```

`npm run verify` is the repository-level completion gate.

## Evals, not prompt faith

A detector is not considered improved because an agent says it is improved. The change must add or update fixtures and demonstrate expected behavior through `npm run evals`.

## Delegation policy

Use subagents for bounded tasks with low write overlap, for example:

- research a framework convention;
- propose test cases;
- independently review a detector for false positives;
- inspect documentation consistency.

Do not delegate several agents to edit the same parser simultaneously. The parent agent owns integration and final verification.

## Tooling policy

MCP/plugins are optional accelerators for contributors, not runtime dependencies of Detent. The project should remain buildable and testable with Node.js, npm, and Git alone.
