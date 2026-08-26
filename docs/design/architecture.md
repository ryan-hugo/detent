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

- `src/adapters/extract.ts`: syntactic extraction over the TypeScript AST, shared by every adapter. Uses `ts.createSourceFile` only — never `createProgram` or a type checker — so no module is resolved and no target code runs.
- `src/adapters/resolve.ts`: follows calls into helpers, bounded and cycle-safe, never reading outside the project root.
- `src/adapters/shared.ts`: filesystem walk and config loading, so adapters do not duplicate the symlink guard.
- `src/adapters/detect.ts`: picks an adapter from `package.json`, falling back to layout.
- `src/adapters/nextjs/scan.ts`, `src/adapters/sveltekit/scan.ts`: map each framework's conventions onto the security model.
- `src/core/model.ts`: stable intermediate representation.
- `src/core/git.ts`: reads historical trees for the diff baseline. Executes only `git`, never target code, and never mutates the working tree.
- `src/core/config.ts`: project-local vocabulary (`detent.config.json`), validated from JSON. Data only — never imported as code.
- `src/core/findings.ts`: deterministic rules over the model (the tool's opinion).
- `src/core/classify.ts`: what a call name means. Framework-agnostic, so adapters share one vocabulary.
- `src/core/contract.ts`: explicit invariants declared by the team, checked against the model. Data only, never executed.
- `src/core/explain.ts`: reports why an entry point was classified as it was, from evidence already in the model. Reports reasoning, never performs any.
- `src/core/enrich.ts`: adds reachability context to another scanner's SARIF output. Matches by path only — no file named in a SARIF is ever opened.
- `src/core/diff.ts`: semantic comparison between models.
- `src/reporters/`: presentation only; no security logic. `text.ts` for terminals/CI logs, `markdown.ts` for pull-request surfaces, `html.ts` for a self-contained offline report. Reporters must escape all model-derived strings, since identifiers originate in untrusted target code.
- `test/fixtures/`: executable examples are *not* executed; they are parser fixtures.

## Architectural boundaries

The Application Security Model is the product core. Adapters may change frequently as frameworks evolve. Rules and reporters consume the model rather than framework ASTs directly.

No code from scanned repositories is imported or evaluated. The one subprocess the tool spawns is `git` itself, always via `execFile` with an argument array so a ref name cannot become a command. Static parsing is a hard security boundary: the adapter parses text into an AST and reads it, which is why type-directed analysis (requiring module resolution) is deliberately out of scope.
