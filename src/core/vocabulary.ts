import type { EntryPoint } from "./model.js";

/**
 * Infers a project's own guard vocabulary from how the code is shaped.
 *
 * Requiring `detent.config.json` before the tool is useful is a real adoption
 * problem: a team has to understand the tool before it can help them. But a
 * project already tells you what its guards are — a wrapper that sits in front
 * of most entry points and nowhere else is doing exactly one job.
 *
 * This is a suggestion, never a silent decision. The scanner does not apply it;
 * `detent init` writes it to a config the team reviews and owns. Evidence
 * proposes, people decide.
 */

export interface VocabularySuggestion {
  name: string;
  /** How many entry points route through it. */
  coverage: number;
  /** Share of all entry points, 0..1. */
  share: number;
  access: "admin" | "authenticated";
  reason: string;
}

/** A call that is plainly not a guard, however often it appears. */
const NEVER_A_GUARD =
  /^(json|parse|stringify|map|filter|find|get|set|has|toString|valueOf|then|catch|log|error|warn|info|redirect|notFound|revalidatePath|revalidateTag|cookies|headers|fetch|NextResponse|Response)$/i;

function baseName(name: string): string {
  const parts = name.split(".");
  return parts[parts.length - 1] ?? name;
}

/**
 * Names that wrap or precede enough entry points to look like a barrier.
 *
 * Two signals are required together, because either alone is noisy: the call
 * appears in a large share of entry points, and it reads like a gate rather
 * than a data operation.
 */
export function suggestVocabulary(entryPoints: EntryPoint[]): VocabularySuggestion[] {
  if (entryPoints.length < 4) return []; // too small a sample to infer anything

  const counts = new Map<string, number>();
  for (const entry of entryPoints) {
    // Count each name once per entry point, so a loop cannot inflate it.
    const namesHere = new Set<string>();
    for (const name of entry.reachableCalls ?? []) namesHere.add(baseName(name));
    for (const name of namesHere) counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  const suggestions: VocabularySuggestion[] = [];
  for (const [name, coverage] of counts) {
    if (NEVER_A_GUARD.test(name)) continue;
    const share = coverage / entryPoints.length;
    if (share < 0.25 || coverage < 3) continue;

    // `withX`, `requireX`, `ensureX`, `assertX`, `protectX` and `guardX` are the
    // shapes teams reach for when writing a barrier.
    const gateShaped = /^(with|require|ensure|assert|protect|guard|check|verify)[A-Z]/.test(name);
    if (!gateShaped) continue;

    suggestions.push({
      name,
      coverage,
      share,
      access: /admin|owner|superuser/i.test(name) ? "admin" : "authenticated",
      reason: `wraps ${coverage} of ${entryPoints.length} entry points`,
    });
  }

  return suggestions.sort((a, b) => b.coverage - a.coverage);
}
