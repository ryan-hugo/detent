# Evaluation harness

Unit tests protect implementation details. Evals protect product behavior.

Each eval fixture is a small source tree representing a security-relevant application pattern. The harness extracts an Application Security Model and checks observable expectations such as:

- expected entry point count;
- required rule IDs;
- later: expected access levels, security diffs, and absence of noisy findings.

Run:

```bash
npm run evals
```

## Rules for changing detectors

1. Add a minimal positive fixture.
2. Add a safe/negative counterexample when false positives are plausible.
3. Add an expectation to the eval harness.
4. Run `npm run verify`.
5. Document known limitations when static evidence cannot prove a claim.

The eval suite should grow from real patterns, not synthetic rule-count inflation.
