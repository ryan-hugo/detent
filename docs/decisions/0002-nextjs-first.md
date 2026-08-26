# ADR 0002 — Next.js + TypeScript first

Status: accepted

## Decision

v0 supports Next.js App Router projects written in TypeScript/TSX.

## Why

Depth is more valuable than broad but shallow language coverage. A framework adapter boundary lets contributors add other ecosystems later without weakening the core model.

## Status update (2026-08-26)

The exit criterion was met and a SvelteKit adapter was added. Generic work — AST
extraction, call resolution, the filesystem walk, and call classification — moved
to `src/adapters/*.ts` and `src/core/classify.ts` first, so the second adapter
added conventions rather than duplicating machinery.

## Exit criterion

A second framework adapter should only be added after the Next.js model is useful enough to produce meaningful `inspect` and `diff` output in real repositories.
