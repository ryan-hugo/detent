import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Reads a git tree into a temporary directory so a model can be built from it.
 *
 * Only `git` itself is executed, always via execFile with an argument array —
 * never a shell string, so a branch name cannot inject a command. Target code is
 * still only ever written to disk and parsed; nothing from the tree is run.
 *
 * The working tree is never touched: no checkout, no stash, no index change.
 * `ls-tree` + `show` read history directly.
 */

export class GitError extends Error {}

const MAX_BUFFER = 64 * 1024 * 1024;

function git(root: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (cause) {
    const detail = (cause as { stderr?: string; message: string }).stderr?.trim();
    throw new GitError(detail || (cause as Error).message);
  }
}

export function isGitRepository(root: string): boolean {
  try {
    return git(root, ["rev-parse", "--is-inside-work-tree"]).trim() === "true";
  } catch {
    return false;
  }
}

/** Resolves a ref to a commit sha, so error messages can name what was compared. */
export function resolveRef(root: string, ref: string): string {
  try {
    const sha = git(root, ["rev-parse", "--verify", `${ref}^{commit}`]).trim();
    if (!sha) throw new GitError("");
    return sha;
  } catch {
    // git's own message here ("Needed a single revision") does not name the ref.
    throw new GitError(`Unknown ref: ${ref}\nCheck the branch or commit exists, e.g. 'git rev-parse ${ref}'.`);
  }
}

/**
 * Paths of scannable source files, relative to `root`.
 *
 * Run with `-C root`, `ls-tree` already reports paths relative to that
 * directory, so a project nested in a monorepo needs no prefix handling here.
 */
interface TreeEntry {
  sha: string;
  file: string;
}

function treeFiles(root: string, ref: string): TreeEntry[] {
  // Object ids come back with the paths so the contents can be fetched in one
  // batch below, rather than one `git show` per file.
  const out = git(root, ["ls-tree", "-r", "-z", "--format=%(objectname) %(path)", ref]);
  const entries: TreeEntry[] = [];
  for (const line of out.split("\0")) {
    if (!line) continue;
    const space = line.indexOf(" ");
    if (space < 0) continue;
    const sha = line.slice(0, space);
    const file = line.slice(space + 1);
    if (/\.(ts|tsx|json)$/.test(file) && !file.endsWith(".d.ts")) entries.push({ sha, file });
  }
  return entries;
}

/**
 * Reads many blobs through a single `git cat-file --batch` process.
 *
 * One subprocess per file is fine for a fixture and unusable for a real
 * monorepo: dub is ~4200 scannable files, which took minutes before this.
 */
function readBlobs(root: string, entries: TreeEntry[]): Map<string, Buffer> {
  const contents = new Map<string, Buffer>();
  if (entries.length === 0) return contents;

  const stdout = execFileSync("git", ["-C", root, "cat-file", "--batch"], {
    input: `${entries.map((entry) => entry.sha).join("\n")}\n`,
    maxBuffer: MAX_BUFFER,
    stdio: ["pipe", "pipe", "pipe"],
  }) as unknown as Buffer;

  // Each record is `<sha> <type> <size>\n<size bytes>\n`. Walk by byte length,
  // never by line, so content containing newlines stays intact.
  let offset = 0;
  for (const entry of entries) {
    const newline = stdout.indexOf(0x0a, offset);
    if (newline < 0) break;
    const header = stdout.toString("utf8", offset, newline);
    const size = Number(header.slice(header.lastIndexOf(" ") + 1));
    if (!Number.isFinite(size)) break;
    const start = newline + 1;
    contents.set(entry.file, stdout.subarray(start, start + size));
    offset = start + size + 1; // trailing newline after the payload
  }
  return contents;
}

/**
 * Materializes `ref` into a fresh temporary directory and returns its path.
 * The caller owns the directory and must remove it.
 */
export function materializeTree(root: string, ref: string): string {
  resolveRef(root, ref); // fail fast, and with a message naming the ref
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "detent-"));

  const entries = treeFiles(root, ref);
  const contents = readBlobs(root, entries);

  for (const { file } of entries) {
    // Refuse anything that would escape the temp directory. Git does not
    // produce such paths, but writing by untrusted name warrants the check.
    const destination = path.resolve(target, file);
    if (destination !== target && !destination.startsWith(target + path.sep)) {
      throw new GitError(`Refusing to write outside the temporary tree: ${file}`);
    }
    const content = contents.get(file);
    if (content === undefined) continue;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
  }

  return target;
}

/** Runs `work` against a materialized tree, always cleaning up afterwards. */
export function withTree<T>(root: string, ref: string, work: (dir: string) => T): T {
  const dir = materializeTree(root, ref);
  try {
    return work(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export interface CommitInfo {
  sha: string;
  /** Author date, ISO-8601. */
  date: string;
  author: string;
  subject: string;
}

/** True when the repository was cloned with truncated history. */
export function isShallow(root: string): boolean {
  try {
    return git(root, ["rev-parse", "--is-shallow-repository"]).trim() === "true";
  } catch {
    return false;
  }
}

/**
 * Commits reachable from `ref`, newest first.
 *
 * Follows first-parent only. A merge brings in commits that were never on the
 * main line, and attributing a posture change to one of them would name a
 * commit that never independently produced that state on this branch. The
 * merge itself is where the change arrived, which is what first-parent reports.
 *
 * `paths` filters to commits that touched those pathspecs. Filtering by file
 * extension is safe — a posture change requires editing source or config — but
 * filtering by the route's own file would not be: a guard removed from a shared
 * helper changes the route without touching it.
 */
export function listCommits(
  root: string,
  ref: string,
  options: { limit: number; since?: string; paths?: string[] },
): CommitInfo[] {
  const args = [
    "log",
    "--first-parent",
    `--max-count=${Math.max(1, Math.floor(options.limit))}`,
    // A unit separator cannot appear in these fields, unlike any printable char.
    "--format=%H%x1f%aI%x1f%an%x1f%s",
    ref,
  ];
  if (options.since) args.push(`--since=${options.since}`);
  if (options.paths && options.paths.length > 0) args.push("--", ...options.paths);

  return git(root, args)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha = "", date = "", author = "", subject = ""] = line.split("\x1f");
      return { sha, date, author, subject };
    })
    .filter((commit) => commit.sha.length > 0);
}
