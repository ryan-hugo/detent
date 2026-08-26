# ADR 0003 — no interactive CLI or TUI

Status: accepted
Date: 2026-08-26

## Context

Agent-style terminal tools (Claude Code, Codex CLI) popularised a shape: run a
bare command, get a persistent session in the current directory, converse with
it. The question was whether Detent should adopt that shape.

The premise needed checking first. Detent has no GUI to complement — it is
already a CLI, with no frontend, backend, database, session, or authentication.
`dependencies` is a single entry (`typescript`), the binary is `dist/cli.js`, and
the tool is stateless: every command reads a directory and exits.

## Decision

Keep the current single-shot, non-interactive CLI. Do not add an interactive
mode, a TUI, a session model, or a daemon.

## Why

**A session has nothing to hold.** Detent answers three questions — what exists,
what changed, what must hold — and each is one command that reads the filesystem
and exits. There is no authentication to keep, no connection to reuse, no partial
work to resume. An interactive prompt would wrap seven commands in a menu.

**The cost it would amortise is not there.** A full scan of a real repository
takes ~0.78s, and roughly 12s on a 4200-file monorepo where the work is git I/O a
session would not avoid. Typical use is once or twice before opening a pull
request, plus once per CI push. A persistent process would save under a second at
a frequency measured per day.

**Composability already exists and is worth more.** JSON on stdout, diagnostics
on stderr, and three distinct exit codes (0 clean, 1 blocking, 2 misuse) mean the
tool already pipes into `jq`, other tools, and agents. An interactive mode is the
one interface a pipeline cannot use.

**The core is already interface-free.** 2564 lines of core, adapters and
reporters against 246 lines of CLI, with zero imports from core back into the
interface. If a second interface is ever justified, adding it is a small job —
which is exactly why it should wait until something concrete demands it.

## Consequences

- Any future interface (MCP server, GitHub Action, editor extension) consumes
  `src/core` directly; the boundary that makes that cheap is already enforced by
  `npm run hygiene`.
- Terminal output stays optimised for reading once and for piping, not for
  navigating.
- The roadmap item "Agent context" is a compact output format, not a session.
  Reconsider it when an agent integration actually exists to consume it —
  `--json` plus `jq` covers the case until then.

## Revisit when

- Detent gains work that is long-running or resumable, where losing progress on
  exit would matter.
- A remote or authenticated mode appears, giving a session something to hold.
- Real usage shows the same repository being queried many times in a sitting.
