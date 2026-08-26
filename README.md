# Detent

> **detent** *(n.)* — the catch in a ratchet that lets motion advance but holds it from slipping backward.

A **local-first application security model compiler** for modern web applications.

Authorization tends to ratchet the wrong way. A guard gets removed during a refactor, a route moves out from behind a check, a secret picks up a `NEXT_PUBLIC_` prefix — each one a small step down, none of them loud enough to notice in a diff. Detent records where every entry point sits and fails the build when something slips.

Instead of asking only “does this repository match a vulnerability pattern?”, Detent starts with a developer-facing question:

> **What security-relevant behavior exists in this application, and what did my change alter?**

Adapters target **Next.js App Router** and **SvelteKit**, both TypeScript.

## Why this exists

Modern coding agents can generate and change large amounts of code quickly. Traditional scanners are still valuable for CVEs, secrets, and known vulnerability patterns, but code review also needs a compact model of application behavior: entry points, authorization barriers, client/server boundaries, sensitive operations, and later database/integration boundaries.

Detent compiles those facts locally into an Application Security Model (ASM), then derives deterministic findings and semantic security diffs.

No account. No mandatory backend. No LLM required. Target code is parsed, never executed.

## Current vertical slice

```bash
npm install
npm run build
node dist/cli.js inspect ./your-next-app
```

Commands:

```bash
detent inspect  [project] [--json] [--html PATH]
detent snapshot [project] [--out PATH]
detent diff     [project] [--base REF | --baseline PATH] [--json] [--html PATH] [--markdown]
detent contract [project] [--contract PATH] [--json] [--html PATH] [--markdown]
detent explain  [project] --route ROUTE [--json]
detent triage   [project] --sarif PATH [--json]
detent init     [project] [--force]
detent graph    [project] [--html PATH]

# global: --framework nextjs|sveltekit  (skips auto-detection)
```

`inspect` currently discovers:

- Next.js Route Handlers;
- `use server` module exports;
- coarse authorization signals;
- sensitive write/payment operations;
- `use client` boundaries;
- environment-variable exposure;
- evidence-backed v0 findings.

`--html` writes a self-contained visual report (severity summary, findings, and an entry-point/access table) that opens directly in a browser. It embeds its own CSS, makes no network requests, and requires no server.

`snapshot` stores a local baseline under `.detent/model.json`. `diff` compares current behavior against that baseline and can fail CI when it detects a high/critical regression.

## Comparing against a branch

In a git repository you do not need a snapshot file at all:

```bash
detent diff --base origin/main
```

Detent builds the baseline model straight from that ref's tree, compares it to your working tree, and exits 1 on a high/critical regression. The ref's own `detent.config.json` is used for the baseline, so renaming a guard in the same PR is compared honestly.

Reading history never touches your working tree — no checkout, no stash, no index change. Files are read with `git ls-tree`/`git show` into a temporary directory that is removed afterwards.

## Declaring what must hold

A finding is the tool's opinion, and you can argue with it. A contract is your team's decision, and a breach is unambiguous. Declare invariants in `detent.contract.json`:

```json
{
  "requirements": [
    { "rule": "entry-point-requires-access", "match": "/api/admin/*", "access": "admin" },
    { "rule": "env-is-server-only", "name": "STRIPE_SECRET_KEY" },
    { "rule": "sensitive-operation-requires-guard", "category": "payment" },
    { "rule": "siblings-agree-on-access", "match": "/api/admin/*" },
    { "rule": "no-public-entry-point", "match": "/api/internal/*" }
  ]
}
```

The last two need no per-route declaration, which is what makes them hold up over time. `siblings-agree-on-access` catches the one route in a group that someone forgot to guard; `no-public-entry-point` catches a route that did not exist when the contract was written.

```bash
detent contract
```

```
BREACH entry-point-requires-access
  app/api/admin/users/route.ts:1
  expected: /api/admin/* requires admin
  actual:   authenticated
```

Every breach states what you demanded and what the model actually shows. `match` accepts `*`. A breach exits 1.

## Asking why

A verdict you cannot check is a verdict you have to trust. `explain` shows the evidence behind one:

```bash
detent explain --route /api/posts/[postId]
```

```
DELETE /api/posts/[postId]
  app/api/posts/[postId]/route.ts:14

  Access: authenticated
  Evidence:
    verifyCurrentUserHasAccessToPost()
      -> getServerSession()
      establishes: authenticated (app/api/posts/[postId]/route.ts:84)
  Reaches: database-write
```

The chain is the point: this route is not guarded by anything you can see in the handler. The guard is one call away, and that is exactly the case a reviewer misses.

An entry point with no guard says so rather than showing an empty section. A route with several HTTP methods explains each one — answering for only `GET` would hide the `DELETE` you did not think to ask about. Nothing here is inferred: `explain` reports the reasoning the scanner already did, so the same tree always produces the same answer.

`--json` gives the same content for scripts and agents.

## Asking when it changed

`explain` says why a route is classified as it is. `blame` says when that stopped being something else:

```bash
detent blame --route /api/admin/users
```

```
Route: /api/admin/users

  Current access: public

  Posture changed: authenticated -> public

  Changed in: abde06ee  2026-08-14
    Test Dev  C3: guard removed

  Evidence before:
    auth()

  Evidence after:
    none detected

  Removed: auth
```

This is not `git blame`. It does not ask who edited a line — it scans historical trees with the same scanner and reports the commit where the model's answer changed. It says *changed in*, never *caused by*: the evidence shows the posture differs across that commit, not that anyone intended it.

A route that did not exist is reported as `absent`, never as `public` — those are different states, and confusing them would flag every newly added route as having been exposed.

`--max-commits N` (default 40) and `--since "30 days ago"` bound the search. The walk stops at the first difference, so a recent change costs a few scans rather than the whole limit. When the limit is reached or the clone is shallow, the output says history is incomplete rather than claiming the route never changed.

## Seeing what reaches what

```bash
detent graph --html paths.html
```

Draws one chain per entry point — origin, barrier, entry point, effect:

```
network ── no barrier ── DELETE /api/admin/users ── database-write
```

Paths that reach a sensitive operation with no barrier sort to the top, because those are the ones worth looking at first.

## In a pull request

```yaml
- run: npx detent diff --base "origin/${{ github.base_ref }}" --markdown
```

Writes the security diff to the job summary, where the reviewer already is. It is a file the runner provides — no token, no API call, nothing leaves the machine. The step fails when a change weakens the model.

## Triaging another scanner's output

Semgrep and CodeQL answer *is this line dangerous*. They cannot answer *can a stranger reach it*. Detent can, so the two compose:

```bash
semgrep --sarif -o results.sarif
npx detent triage --sarif results.sarif
```

```
CRITICAL sql-injection
  app/actions/billing.ts:4
  reachable at: public via 2 entry points

LOW weak-random
  lib/unused-helper.ts:9
  not on any known entry-point path
```

Same rules, same severities from the scanner — reordered by whether anyone can actually get there. Only publicly reachable findings fail the build.

## Frameworks

Next.js App Router and SvelteKit. The adapter is chosen from your `package.json`, falling back to project layout; `--framework nextjs|sveltekit` overrides it.

## Getting started in one command

```bash
npx detent init
```

Detent reads how your project is written and infers your own guard vocabulary. A wrapper that fronts most of your entry points is doing one job, and it is not data access. On a real monorepo of 720 entry points this found `withWorkspace` on its own in under eight seconds:

```
Inferred from how this project is written:

  withWorkspace -> authenticated   wraps 257 of 720 entry points
```

It writes `detent.config.json` for you to review. Nothing is applied silently — evidence proposes, you decide.

## Teaching it your vocabulary

The built-in detectors recognize common English guard names. Your codebase probably names things its own way, which goes wrong in both directions: a real guard reads as `public`, or a function whose name merely contains "admin" is mistaken for an authorization barrier.

Drop a `detent.config.json` at the project root:

```json
{
  "guards": {
    "exigirGestor": "admin",
    "obterSessao": "authenticated"
  },
  "notGuards": ["checkAdminBanner"],
  "sensitive": {
    "enviarCobranca": "payment"
  }
}
```

- `guards` maps a function name to the access level calling it establishes.
- `notGuards` denies a name that the built-in heuristics would otherwise believe. Denial always wins.
- `sensitive` marks a call as a sensitive operation (`database-write`, `payment`, `filesystem`, `process`, `other`).

Names match either the full dotted callee or its last segment, so `exigirGestor` also matches `guards.exigirGestor()`. The file is read as JSON and never imported, so it cannot execute code. An invalid mapping is rejected with an error rather than silently ignored — a typo that read as "no guard" would be the unsafe default.

## Roadmap

1. **Inspect** — reliable Next.js Application Security Model.
2. **Diff** — PR-oriented semantic security changes.
3. **Contract** — explicit developer-defined security invariants.
4. **Graph** — local attack-path/security-architecture visualization.
5. **Agent context** — compact MCP/CLI context for coding agents, without making an LLM part of detection.

## Agent-ready repository

This repository is itself built for 2026-era agentic development:

- `AGENTS.md` is a short map, not a giant manual;
- `docs/` is the source of truth;
- `.agents/skills/` contains reusable Agent Skills;
- `.github/agents/` contains specialist custom-agent profiles;
- `.github/instructions/` scopes instructions to code paths;
- fixtures + evals provide deterministic feedback to human and AI contributors.

Run the completion gate:

```bash
npm run verify
```

## Status

`0.1.0-alpha` — architecture and first functional Next.js extraction slice.
