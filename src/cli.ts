#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { AdapterError, scanProject } from "./adapters/detect.js";
import { diffModels } from "./core/diff.js";
import { GitError, isGitRepository, resolveRef, withTree } from "./core/git.js";
import { CONTRACT_FILENAME, ContractError, checkContract, parseContract } from "./core/contract.js";
import { CONFIG_FILENAME, ConfigError } from "./core/config.js";
import { suggestVocabulary } from "./core/vocabulary.js";
import { EnrichError, enrichFindings, parseSarif } from "./core/enrich.js";
import { ExplainError, explain, knownSubjects } from "./core/explain.js";
import type { ApplicationSecurityModel } from "./core/model.js";
import { renderBreaches, renderDiff, renderExplanations, renderModel, renderTriage } from "./reporters/text.js";
import { renderContractHtml, renderDiffHtml, renderGraphHtml, renderModelHtml } from "./reporters/html.js";
import { renderContractMarkdown, renderDiffMarkdown } from "./reporters/markdown.js";

function usage(): never {
  console.error(
    [
      "detent <command> [project]",
      "",
      "Commands:",
      "  init      [project] [--force]",
      "  inspect   [project] [--json] [--html PATH]",
      "  snapshot  [project] [--out PATH]",
      "  diff      [project] [--base REF | --baseline PATH] [--json] [--html PATH] [--markdown]",
      "  contract  [project] [--contract PATH] [--json] [--html PATH] [--markdown]",
      "  explain   [project] --route ROUTE [--json]",
      "  triage    [project] --sarif PATH [--json]",
      "  graph     [project] [--html PATH]",
      "  version",
      "",
      "Global:",
      "  --framework nextjs|sveltekit   skip auto-detection",
    ].join("\n"),
  );
  process.exit(2);
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function writeHtml(target: string, html: string): void {
  const out = path.resolve(target);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.error(`HTML report written to ${out}`);
}

/**
 * Writes markdown where a reviewer will see it.
 *
 * Prefers `$GITHUB_STEP_SUMMARY`, which GitHub renders on the job page. It is a
 * plain file the runner provides, so no token and no network call are involved.
 * Falls back to stdout everywhere else.
 */
function writeMarkdown(body: string): void {
  const summary = process.env?.["GITHUB_STEP_SUMMARY"];
  if (summary) {
    fs.appendFileSync(summary, body);
    console.error(`Summary written to ${summary}`);
    return;
  }
  console.log(body);
}

function readModel(file: string): ApplicationSecurityModel {
  return JSON.parse(fs.readFileSync(file, "utf8")) as ApplicationSecurityModel;
}

const args = process.argv.slice(2);
const command = args[0];
if (!command) usage();

if (command === "version") {
  console.log("0.1.0-alpha.0");
  process.exit(0);
}

const FRAMEWORKS = ["nextjs", "sveltekit"] as const;
const requested = option(args, "--framework");
if (requested !== undefined && !FRAMEWORKS.includes(requested as (typeof FRAMEWORKS)[number])) {
  // Silently falling back would scan with the wrong adapter and report a model
  // the user never asked for, which is worse than refusing.
  console.error(`Unknown framework: ${requested}\nExpected one of ${FRAMEWORKS.join(", ")}.`);
  process.exit(2);
}
const framework = requested as (typeof FRAMEWORKS)[number] | undefined;
const scan = (dir: string) => scanProject(dir, framework);

const project = args[1] && !args[1].startsWith("--") ? args[1] : ".";
const root = path.resolve(project);

try {
  if (command === "inspect") {
    const model = scan(root);
    const htmlOut = option(args, "--html");
    if (htmlOut) writeHtml(htmlOut, renderModelHtml(model));
    else console.log(args.includes("--json") ? JSON.stringify(model, null, 2) : renderModel(model));
  } else if (command === "snapshot") {
    const model = scan(root);
    const out = path.resolve(option(args, "--out") ?? path.join(root, ".detent", "model.json"));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(model, null, 2)}\n`);
    console.log(`Snapshot written to ${out}`);
  } else if (command === "contract") {
    const file = path.resolve(option(args, "--contract") ?? path.join(root, CONTRACT_FILENAME));
    if (!fs.existsSync(file)) {
      console.error(`No contract found at ${file}\nDeclare requirements in ${CONTRACT_FILENAME} to check them.`);
      process.exit(2);
    }
    let parsed;
    try {
      parsed = parseContract(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch (cause) {
      throw new ContractError(`${CONTRACT_FILENAME}: ${(cause as Error).message}`);
    }
    const model = scan(root);
    const breaches = checkContract(parsed, model);
    const htmlOut = option(args, "--html");
    if (htmlOut) writeHtml(htmlOut, renderContractHtml(breaches, parsed.requirements.length, root));
    else if (args.includes("--markdown")) writeMarkdown(renderContractMarkdown(breaches, parsed.requirements.length));
    else console.log(args.includes("--json") ? JSON.stringify(breaches, null, 2) : renderBreaches(breaches));
    // A breached invariant is not advice. It fails.
    if (breaches.length > 0) process.exitCode = 1;
  } else if (command === "init") {
    const model = scan(root);
    const suggestions = suggestVocabulary(model.entryPoints);
    const target = path.join(root, CONFIG_FILENAME);

    if (suggestions.length === 0) {
      console.log(
        `No project-specific guards inferred from ${model.entryPoints.length} entry points.\n` +
          `The built-in vocabulary may already be enough. Add guards by hand if it is not.`,
      );
    } else {
      const guards: Record<string, string> = {};
      console.log("Inferred from how this project is written:\n");
      for (const item of suggestions) {
        guards[item.name] = item.access;
        console.log(`  ${item.name} -> ${item.access}   ${item.reason}`);
      }
      if (fs.existsSync(target) && !args.includes("--force")) {
        console.log(`\n${CONFIG_FILENAME} already exists. Re-run with --force to overwrite it.`);
      } else {
        fs.writeFileSync(target, `${JSON.stringify({ guards }, null, 2)}\n`);
        console.log(
          `\nWritten to ${target}\n` +
            `Review it before trusting it: a wrong mapping here makes the tool believe\n` +
            `a barrier that is not there.`,
        );
      }
    }
  } else if (command === "triage") {
    const input = option(args, "--sarif");
    if (!input) {
      console.error(
        `triage needs a SARIF file: detent triage [project] --sarif results.sarif\n` +
          `Produce one with 'semgrep --sarif -o results.sarif' or from a CodeQL run.`,
      );
      process.exit(2);
    }
    const file = path.resolve(input);
    if (!fs.existsSync(file)) {
      console.error(`SARIF file not found: ${file}`);
      process.exit(2);
    }
    let external;
    try {
      external = parseSarif(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch (cause) {
      throw new EnrichError(`${input}: ${(cause as Error).message}`);
    }

    const enriched = enrichFindings(scan(root), external);
    if (args.includes("--json")) {
      console.log(JSON.stringify(enriched, null, 2));
    } else {
      console.log(renderTriage(enriched));
    }
    // Anything a stranger can reach fails the build; the rest is reported.
    if (enriched.some((finding) => finding.priority === "critical")) process.exitCode = 1;
  } else if (command === "explain") {
    // A route starts with `/`, which the positional project argument would
    // swallow, so the subject is a named flag like every other one here.
    const subject = option(args, "--route");
    if (!subject) {
      console.error(
        `explain needs a route: detent explain [project] --route /api/posts\n` +
          `An export name or entry-point id works too.`,
      );
      process.exit(2);
    }

    const model = scan(root);
    let explanations;
    try {
      explanations = explain(model, subject);
    } catch (cause) {
      if (!(cause instanceof ExplainError)) throw cause;
      const known = knownSubjects(model);
      console.error(
        known.length > 0
          ? `${cause.message}\n\nKnown entry points:\n${known.map((item) => `  ${item}`).join("\n")}`
          : `${cause.message}\n\nNo entry points were discovered in ${root}.`,
      );
      process.exit(2);
    }

    console.log(
      args.includes("--json") ? JSON.stringify(explanations, null, 2) : renderExplanations(explanations),
    );
  } else if (command === "graph") {
    const model = scan(root);
    const out = option(args, "--html") ?? path.join(root, ".detent", "graph.html");
    writeHtml(out, renderGraphHtml(model));
  } else if (command === "diff") {
    const base = option(args, "--base");
    let before: ApplicationSecurityModel;

    if (base) {
      // Git-native: build the baseline from history, no snapshot file needed.
      if (!isGitRepository(root)) {
        console.error(`--base needs a git repository, and ${root} is not one.\nUse 'detent snapshot' to record a baseline file instead.`);
        process.exit(2);
      }
      const sha = resolveRef(root, base);
      console.error(`Comparing against ${base} (${sha.slice(0, 8)})`);
      before = withTree(root, base, (dir) => {
        const model = scan(dir);
        // The temp path is an implementation detail; report the real root.
        return { ...model, root };
      });
    } else {
      const baseline = path.resolve(option(args, "--baseline") ?? path.join(root, ".detent", "model.json"));
      if (!fs.existsSync(baseline)) {
        console.error(`Baseline not found: ${baseline}\nRun 'detent snapshot ${project}' first, or compare against git with --base <ref>.`);
        process.exit(2);
      }
      before = readModel(baseline);
    }

    const after = scan(root);
    const changes = diffModels(before, after);
    const diffHtmlOut = option(args, "--html");
    if (diffHtmlOut) writeHtml(diffHtmlOut, renderDiffHtml(changes, root));
    else if (args.includes("--markdown")) writeMarkdown(renderDiffMarkdown(changes, base));
    else console.log(args.includes("--json") ? JSON.stringify(changes, null, 2) : renderDiff(changes));
    if (changes.some((change) => change.severity === "critical" || change.severity === "high")) process.exitCode = 1;
  } else {
    usage();
  }
} catch (error) {
  // A malformed config is the user's mistake, not a crash. Report it plainly.
  if (error instanceof ConfigError) {
    console.error(`${error.message}\n\nFix the file or delete it to fall back to the built-in vocabulary.`);
    process.exit(2);
  }
  if (error instanceof ContractError) {
    console.error(`${error.message}`);
    process.exit(2);
  }
  if (error instanceof AdapterError) {
    console.error(error.message);
    process.exit(2);
  }
  if (error instanceof EnrichError) {
    console.error(`${error.message}\n\nExpected SARIF 2.1.0, as produced by semgrep --sarif or CodeQL.`);
    process.exit(2);
  }
  if (error instanceof GitError) {
    console.error(`git: ${error.message}`);
    process.exit(2);
  }
  throw error;
}
