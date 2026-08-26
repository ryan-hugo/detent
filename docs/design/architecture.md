# Architecture

## Shape

```text
repository
   |
   v
framework adapter (Next.js v0)
   |
   v
Application Security Model (ASM)
   |-------------------|
   v                   v
rule engine          model diff
   |                   |
   v                   v
findings            security changes
   |                   |
   +---------+---------+
             v
      reporters / MCP later
```

## Modules

- `src/adapters/nextjs/extract.ts`: syntactic extraction over the TypeScript AST. Uses `ts.createSourceFile` only — never `createProgram` or a type checker — so no module is resolved and no target code runs.
- `src/adapters/nextjs/scan.ts`: maps extracted syntax onto the security model.
- `src/core/model.ts`: stable intermediate representation.
- `src/core/git.ts`: reads historical trees for the diff baseline. Executes only `git`, never target code, and never mutates the working tree.
- `src/core/config.ts`: project-local vocabulary (`detent.config.json`), validated from JSON. Data only — never imported as code.
- `src/core/findings.ts`: deterministic rules over the model (the tool's opinion).
- `src/core/contract.ts`: explicit invariants declared by the team, checked against the model. Data only, never executed.
- `src/core/diff.ts`: semantic comparison between models.
- `src/reporters/`: presentation only; no security logic. `text.ts` for terminals/CI logs, `html.ts` for a self-contained offline report. Reporters must escape all model-derived strings, since identifiers originate in untrusted target code.
- `test/fixtures/`: executable examples are *not* executed; they are parser fixtures.

## Architectural boundaries

The Application Security Model is the product core. Adapters may change frequently as frameworks evolve. Rules and reporters consume the model rather than framework ASTs directly.

No code from scanned repositories is imported or evaluated. The one subprocess the tool spawns is `git` itself, always via `execFile` with an argument array so a ref name cannot become a command. Static parsing is a hard security boundary: the adapter parses text into an AST and reads it, which is why type-directed analysis (requiring module resolution) is deliberately out of scope.
