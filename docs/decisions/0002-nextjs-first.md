# ADR 0002 — Next.js + TypeScript first

Status: accepted

## Decision

v0 supports Next.js App Router projects written in TypeScript/TSX.

## Why

Depth is more valuable than broad but shallow language coverage. A framework adapter boundary lets contributors add other ecosystems later without weakening the core model.

## Exit criterion

A second framework adapter should only be added after the Next.js model is useful enough to produce meaningful `inspect` and `diff` output in real repositories.
