/**
 * Repository hygiene checks that are cheap, deterministic, and catch mistakes
 * that actually happened in this repo rather than hypothetical ones.
 *
 * Runs as part of `npm run verify`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|mjs|md|json|yml)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = sourceFiles(root).filter(
  (file) =>
    // Fixtures are deliberately imperfect sample code, and this file names the
    // very patterns it looks for.
    !file.includes(`${path.sep}test${path.sep}fixtures${path.sep}`) &&
    file !== fileURLToPath(import.meta.url),
);

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const shown = path.relative(root, file);

  // Shell-escaping accidents: heredocs and node -e have corrupted files here
  // more than once, and the damage is silent until something else breaks.
  if (/command not found|Is a directory|No such file or directory/.test(text)) {
    failures.push(`${shown}: contains shell error output`);
  }
  // A template placeholder that survived into a committed file.
  if (/\$\{[A-Za-z_]+\}/.test(text) && !/\.(ts|mjs)$/.test(file)) {
    failures.push(`${shown}: unexpanded \${...} placeholder`);
  }
  if (/\.(ts|mjs)$/.test(file) && /\b(TODO|FIXME|XXX)\b/.test(text)) {
    failures.push(`${shown}: leftover TODO/FIXME`);
  }
  if (/\.ts$/.test(file) && /@ts-(ignore|expect-error|nocheck)/.test(text)) {
    failures.push(`${shown}: suppressed type error`);
  }
}

// The security boundary, asserted rather than assumed: only git may be spawned,
// and only from the module that owns that decision.
for (const file of files.filter((f) => f.endsWith('.ts') && f.includes(`${path.sep}src${path.sep}`))) {
  const text = fs.readFileSync(file, 'utf8');
  const shown = path.relative(root, file);
  if (/child_process/.test(text) && !shown.endsWith(path.join('core', 'git.ts')) && !shown.endsWith('node-shim.d.ts')) {
    failures.push(`${shown}: spawns a subprocess outside core/git.ts`);
  }
  if (/\bcreateProgram\b|getTypeChecker/.test(text)) {
    failures.push(`${shown}: type-directed analysis would require module resolution`);
  }
}

if (failures.length > 0) {
  console.error('FAIL hygiene');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log('PASS hygiene');
