# ADR 0001 — local-first, zero mandatory infrastructure

Status: accepted

## Decision

The core product runs on the developer machine or their CI runner. It requires no hosted Detent backend.

## Consequences

- Near-zero operating cost for maintainers.
- Source code does not need to leave the user's environment.
- GitHub Actions can provide collaboration without us operating workers.
- Features that require centralized history/accounts are explicitly out of scope until demonstrated demand exists.
