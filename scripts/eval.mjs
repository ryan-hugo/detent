import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { scanNextProject } from '../dist/adapters/nextjs/scan.js';
import { checkContract, parseContract } from '../dist/core/contract.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cases = [
  {
    name: 'next-basic',
    project: path.join(root, 'test/fixtures/next-basic'),
    expectedRules: ['AUTH001', 'AUTH002', 'ENV001', 'ENV002'],
    expectedEntryPoints: 5,
  },
  {
    // Negative case: guards named only in dead text must not be believed.
    name: 'next-dead-text',
    project: path.join(root, 'test/fixtures/next-dead-text'),
    expectedRules: ['AUTH001'],
    expectedEntryPoints: 1,
  },
  {
    // Only the directive-carrying function is an action.
    name: 'next-inline-action',
    project: path.join(root, 'test/fixtures/next-inline-action'),
    expectedRules: ['AUTH001'],
    expectedEntryPoints: 1,
  },
  {
    // A wrapped handler is discovered, and its wrapper is real evidence.
    name: 'next-wrapped-handler',
    project: path.join(root, 'test/fixtures/next-wrapped-handler'),
    expectedRules: [],
    expectedEntryPoints: 1,
  },
  {
    // Project-local vocabulary: a configured guard is believed, a denied one is not.
    name: 'next-custom-vocab',
    project: path.join(root, 'test/fixtures/next-custom-vocab'),
    expectedRules: ['AUTH001'],
    expectedEntryPoints: 3,
  },
  {
    // A guard reached through a helper must silence the rule, not trip it.
    name: 'next-helper-chain',
    project: path.join(root, 'test/fixtures/next-helper-chain'),
    expectedRules: [],
    expectedEntryPoints: 1,
  },
  {
    // Signature verification is authentication.
    name: 'next-webhook',
    project: path.join(root, 'test/fixtures/next-webhook'),
    expectedRules: [],
    expectedEntryPoints: 1,
  },
];

// A fixture may declare a contract; if it does, the breach count is an expectation too.
const contractCases = [
  { name: 'next-basic', project: path.join(root, 'test/fixtures/next-basic'), expectedBreaches: 3 },
];

let failures = 0;
for (const item of cases) {
  const model = scanNextProject(item.project);
  const rules = new Set(model.findings.map((finding) => finding.ruleId));
  const missing = item.expectedRules.filter((rule) => !rules.has(rule));
  const pass = missing.length === 0 && model.entryPoints.length === item.expectedEntryPoints;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${item.name} — entryPoints=${model.entryPoints.length}, findings=${model.findings.length}`);
  if (missing.length) console.log(`  missing rules: ${missing.join(', ')}`);
  if (!pass) failures += 1;
}

for (const item of contractCases) {
  const file = path.join(item.project, 'detent.contract.json');
  const contract = parseContract(JSON.parse(fs.readFileSync(file, 'utf8')));
  const breaches = checkContract(contract, scanNextProject(item.project));
  const pass = breaches.length === item.expectedBreaches;
  console.log(`${pass ? 'PASS' : 'FAIL'} contract:${item.name} — breaches=${breaches.length}, expected=${item.expectedBreaches}`);
  if (!pass) failures += 1;
}

if (failures) process.exit(1);
