# Contributing

## Getting set up

```bash
npm install
npm run verify
```

`verify` runs typecheck, tests and evals. It is the completion gate — a change
is not finished until it passes.

## The rules that matter

These come from `AGENTS.md` and are not style preferences:

1. **Never execute target code.** Parsing only. No imports, no package scripts,
   no framework builds, no shell commands built from project content.
2. **Findings need evidence.** A file, a line, a rule id, and a reason the
   signal fired. Prefer no finding over a fabricated one — a scanner that
   invents an authorization barrier is worse than one that stays quiet.
3. **Detection stays deterministic.** The same tree must produce the same
   findings. An LLM must never be required to reach a security verdict.
4. **Every detector change needs a fixture and an eval expectation.** Add a
   positive case, and a negative counterexample when a false positive is
   plausible.

## Adding a detector

See `.agents/skills/add-detector/SKILL.md`. In short: fixture first, then the
rule, then the eval expectation, then `npm run verify`.

## Reporting a security issue

See `SECURITY.md`. Do not open a public issue for anything that could cause code
execution, path escape, or unsafe scanning of untrusted repositories.
