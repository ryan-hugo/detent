# Application Security Model (ASM)

Schema version: 1

The ASM is a deterministic intermediate representation between framework parsing and security reasoning.

## v0 entities

### Entry points

- Route handlers (`GET`, `POST`, `PATCH`, etc.)
- Server Actions in modules with `use server`

Each entry point records source location, route/method where relevant, detected authorization signals, inferred access level, and sensitive operations.

### Authorization signals

v0 uses intentionally conservative name-based detectors for common calls such as `auth`, session helpers, and admin guards. These are evidence signals, not proof of authorization correctness.

### Sensitive operations

v0 recognizes a small set of high-signal operation families: database writes, payment operations, filesystem writes, and process execution.

### Client boundaries

Files with `use client` are represented explicitly. Later versions will model values crossing Server -> Client rather than only file boundaries.

### Environment usage

References to `process.env.*` include whether the name is explicitly client-visible and whether the source file is a client module.

## Design principle

Adapters extract facts. Rules interpret facts. Reporters present facts. Do not collapse these layers.
