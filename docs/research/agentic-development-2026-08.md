# Agentic development baseline — August 2026

Date: 2026-08-25

This note captures the repository-design assumptions used to bootstrap Detent. It is descriptive guidance, not a runtime dependency.

## 1. Repository knowledge is the system of record

OpenAI's 2026 harness-engineering write-up describes abandoning a single oversized `AGENTS.md` in favor of a short map pointing to structured repository documentation. We follow that model: `AGENTS.md` contains invariants and navigation; `docs/` owns detailed truth.

Source: https://openai.com/index/harness-engineering/

## 2. Agent Skills are portable workflow units

OpenAI and GitHub both describe `SKILL.md`-based Agent Skills as reusable workflow packages. GitHub supports project skills under `.github/skills`, `.claude/skills`, or `.agents/skills`; we use `.agents/skills` to avoid tying project knowledge to one host.

Sources:
- https://openai.com/academy/skills/
- https://docs.github.com/en/copilot/concepts/agents/about-agent-skills

## 3. Persistent instructions stay small; specialists get isolated context

GitHub custom agents define specialist prompts/tools/MCP configuration and can run as subagents in isolated contexts. This supports bounded delegation: architecture, security review, and eval design are separate roles rather than one enormous prompt.

Sources:
- https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-custom-agents
- https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/custom-agents

## 4. Deterministic tools are stronger than prompt-only governance

Modern agent hosts expose hooks/tools so builds, tests, linters, and security checks can run deterministically. Our project-level equivalent is `npm run verify`: typecheck + tests + behavioral evals. An agent cannot replace this gate with a narrative assertion.

Source: https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent

## 5. Multi-agent work needs write isolation

OpenAI's Codex app emphasizes parallel agents with isolated worktrees; GitHub subagents use separate contexts. We therefore delegate bounded research/review/eval tasks but avoid simultaneous edits to the same parser module.

Source: https://openai.com/index/introducing-the-codex-app/

## 6. The deployed harness matters

Cursor's Composer 2 report describes training/evaluating coding models in a harness aligned with the deployed environment. The lesson for this repo is simpler: agent feedback should use the same commands contributors and CI use, not bespoke hidden checks.

Source: https://cursor.com/resources/Composer2.pdf

## 7. MCP/plugins are integration surfaces, not product foundations

OpenAI and GitHub both package workflows around skills, apps/tools, and MCP. For Detent, MCP is reserved as a future *output/context interface* for coding agents. Security detection itself must remain deterministic and local.

Sources:
- https://help.openai.com/en/articles/20001256-plugins-in-codex
- https://docs.github.com/en/copilot/concepts/agents/about-plugins

## Practical repository policy

- `AGENTS.md`: universal map/invariants.
- `docs/`: architecture, product, ADRs, eval behavior.
- `.agents/skills/`: task-specific reusable workflows.
- `.github/agents/`: specialist agent/subagent profiles.
- `.github/instructions/`: path-specific coding constraints.
- `test/fixtures/` + `scripts/eval.mjs`: behavioral harness.
- `npm run verify`: completion gate.
