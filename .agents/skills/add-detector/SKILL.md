---
name: add-detector
description: Add or change a deterministic application-security detector. Use when implementing parsing, signals, rules, or findings in Detent.
---

# Add a detector safely

1. Read `AGENTS.md`, `docs/design/application-security-model.md`, and `docs/evals/README.md`.
2. State the fact the adapter can observe and the security interpretation the rule will make. Keep them separate.
3. Prefer high-signal evidence over broad pattern matching. If evidence is ambiguous, represent uncertainty rather than escalating severity.
4. Add the smallest fixture that demonstrates the risky case.
5. Add a safe counterexample whenever the detector could plausibly flag normal code.
6. Update the model schema only if the fact cannot be represented without framework-specific leakage.
7. Implement extraction in an adapter and interpretation in the core rule engine.
8. Ensure every finding has rule ID, severity, source location, explanation, and concrete evidence.
9. Run `npm run verify`.
10. Summarize known false-positive/false-negative boundaries in the relevant design doc.

Never execute code from the target fixture or target repository.
