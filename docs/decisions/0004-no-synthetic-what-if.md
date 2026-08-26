# ADR 0004 — no synthetic what-if analysis

Status: accepted
Date: 2026-08-26

## Context

After `impact` shipped, the obvious next step looked like counterfactual
analysis: delete a symbol, rescan, and report which routes lost their guard.

```bash
detent what-if --remove requireAdmin
```

It was proposed in this repository's own planning, and then tested before being
built.

## Decision

Do not implement synthetic mutation of any kind — `--remove`, `--replace`, or
simulated edits. `detent review` covers the question this was meant to answer.

## Why

**The mutation produces a state that cannot exist.** Deleting a declaration
leaves every import of it pointing at nothing. That tree does not compile, so no
developer would ever reach it, and a security verdict about an impossible state
is not a verdict about anything.

**It is also wrong in practice, not just in principle.** The test case: remove
`requireAdmin` from `lib/guard.ts` while `app/api/a/route.ts` still calls it.
The posture came back `admin -> admin` — unchanged. Classification matches the
call site, not the declaration, so the mutation removed the definition and
changed no answer. The feature would have reported "no impact" for a deletion
that breaks the build.

**The real question already has a real answer.** `detent review` compares HEAD
against the working tree. A developer who wants to know what removing a guard
does can remove it, save, and run `review` — against a state that is genuine,
compilable, and the one they are actually creating.

## Consequences

- The preventive question — "what does my change do to the security model?" —
  is answered by `review`, from two states that exist.
- Two cases stay uncovered: evaluating a change nobody wants to write yet, and
  comparing two design alternatives side by side. Both are weak against the cost,
  and neither is served well by a mutation the tooling cannot trust.
- The rule this reinforces: Detent reports on states that exist. Where evidence
  is absent it says so, rather than manufacturing a state to reason about.

## Revisit when

- A concrete workflow appears where editing the file first is genuinely not an
  option, and the mutated state can be shown to be one the project could reach.
- Classification becomes declaration-aware, which would remove the specific
  failure measured above — though not the "state that never compiles" objection.
