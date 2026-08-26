# Security policy

Detent analyzes untrusted source trees, so parser isolation is part of the product security model.

## Hard boundary

The scanner must not execute code from the repository it analyzes. This includes imports, package scripts, framework builds, shell commands derived from project content, and dynamic module loading.

## The one subprocess

`diff --base <ref>` runs `git` to read a historical tree. This is the only program the tool spawns, and the rules around it are part of the boundary:

- invoked with `execFile` and an argument array, never a shell string, so a ref or path from the repository cannot become a command;
- only read-only plumbing (`rev-parse`, `ls-tree`, `show`) — nothing that mutates the working tree, index, or refs;
- tree contents are written to a temporary directory and parsed, exactly like any other source file, then removed.

Extending this to any other executable, or to `git` subcommands that write, needs an ADR.

## Reporting a vulnerability

Do not publish exploit details in a public issue if the problem can cause code execution, path escape, data disclosure, or unsafe scanning of untrusted repositories. Use a private security report on the eventual public repository.
