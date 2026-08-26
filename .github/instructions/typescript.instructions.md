---
applyTo: "src/**/*.ts"
---

- Keep framework-specific AST logic inside adapters.
- Keep the core model free of TypeScript compiler AST node types.
- Prefer explicit return types at module boundaries.
- Preserve strict TypeScript compatibility and avoid `any`.
- Security heuristics must expose evidence and source locations.
- Do not execute target code.
