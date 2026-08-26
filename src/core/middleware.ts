import type { MiddlewareBarrier } from "./model.js";

/**
 * Next.js middleware (`proxy.ts` since v16) as a security barrier.
 *
 * A route guarded only by middleware carries no evidence in its own body, so
 * name matching over the handler reads it as `public`. That was a wrong answer,
 * not a missing feature: it invented two HIGH findings for a route that is in
 * fact protected.
 *
 * Matching follows the documented `config.matcher` rules rather than treating
 * the pattern as a glob. Patterns are anchored at the start, named parameters
 * carry `*`/`+`/`?` modifiers, and parenthesised groups are real regular
 * expressions — including the negative lookaheads that every real project uses
 * to exclude `_next/static`. Reading `/((?!api).*)`  as a glob would claim the
 * middleware guards `/api/admin`, which is the opposite of what it says.
 */

/**
 * Nested quantifiers that make a pattern catastrophically slow to match.
 *
 * A matcher is untrusted input: it comes from whatever repository is being
 * scanned. A nested quantifier such as a quantified group wrapping another
 * quantifier compiles to a regex that takes exponential time on a
 * non-matching string, and 30 characters is enough to hang the process
 * indefinitely — a denial of service on the machine running the analysis.
 * Found by attacking the matcher rather than exercising it.
 *
 * Refusing these costs nothing real: no legitimate Next.js matcher nests a
 * quantifier inside a quantified group, and refusing means "cannot prove this
 * route is protected", which is the safe direction.
 */
const NESTED_QUANTIFIER = /\([^)]*[+*]\s*\)\s*[+*]|\([^)]*\{\d+,\d*\}[^)]*\)\s*[+*]/;

/**
 * Translates one `matcher` source into a regular expression.
 *
 * Returns undefined when the pattern cannot be modelled faithfully, which is
 * treated as "do not claim this route is protected" rather than as a match.
 */
export function matcherToRegExp(source: string): RegExp | undefined {
  // "MUST start with /" — anything else is not a matcher Next.js would accept,
  // and guessing at its intent is how a tool invents a barrier.
  if (!source.startsWith("/")) return undefined;

  // Refused before compiling, not after: matching one of these is what hangs.
  if (NESTED_QUANTIFIER.test(source)) return undefined;

  // A matcher is a path pattern. Anything this long is not one, and the bound
  // keeps pathological input from reaching the regex engine at all.
  if (source.length > 400) return undefined;

  let pattern = "";
  let index = 0;

  while (index < source.length) {
    const char = source[index] as string;

    // A parenthesised group is a real regular expression and is copied through
    // verbatim, so negative lookaheads keep their meaning. Nesting is tracked
    // because `/((?!api|_next).*)`  closes two parens at the end.
    if (char === "(") {
      let depth = 0;
      let end = index;
      while (end < source.length) {
        if (source[end] === "(" && source[end - 1] !== "\\") depth += 1;
        else if (source[end] === ")" && source[end - 1] !== "\\") {
          depth -= 1;
          if (depth === 0) break;
        }
        end += 1;
      }
      if (depth !== 0) return undefined; // unbalanced: refuse rather than guess
      pattern += source.slice(index, end + 1);
      index = end + 1;
      continue;
    }

    // A named parameter, optionally with a modifier and an inline pattern:
    // `:path*`, `:path+`, `:path?`, `:id(\\d+)`.
    if (char === ":") {
      let end = index + 1;
      while (end < source.length && /[A-Za-z0-9_]/.test(source[end] as string)) end += 1;
      if (end === index + 1) return undefined; // a bare ":" is not a parameter

      let inner = "[^/]+";
      if (source[end] === "(") {
        let depth = 0;
        let close = end;
        while (close < source.length) {
          if (source[close] === "(" && source[close - 1] !== "\\") depth += 1;
          else if (source[close] === ")" && source[close - 1] !== "\\") {
            depth -= 1;
            if (depth === 0) break;
          }
          close += 1;
        }
        if (depth !== 0) return undefined;
        inner = source.slice(end + 1, close);
        end = close + 1;
      }

      const modifier = source[end];
      if (modifier === "*" || modifier === "+") {
        // `*` is zero-or-more segments and `+` is one-or-more. The preceding
        // "/" belongs to the repetition, which is why `/about/:path*` matches
        // `/about` itself as well as `/about/a/b`.
        if (pattern.endsWith("/")) pattern = pattern.slice(0, -1);
        pattern += modifier === "*" ? `(?:/${inner})*` : `(?:/${inner})+`;
        index = end + 1;
        continue;
      }
      if (modifier === "?") {
        if (pattern.endsWith("/")) pattern = pattern.slice(0, -1);
        pattern += `(?:/${inner})?`;
        index = end + 1;
        continue;
      }
      pattern += inner;
      index = end;
      continue;
    }

    // Everything else is a literal and must not be read as regex syntax.
    pattern += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    index += 1;
  }

  try {
    // Anchored at both ends. Next.js anchors at the start; the trailing
    // `(?:/)?` absorbs a trailing slash without letting `/about` match
    // `/aboutus`, which a start-only anchor would wrongly allow.
    return new RegExp(`^${pattern}(?:/)?$`);
  } catch {
    return undefined;
  }
}

/**
 * Whether a middleware barrier applies to a route path.
 *
 * A conditional barrier never matches: if applicability depends on a request
 * header we cannot read, the honest answer is that we cannot prove the route is
 * guarded.
 */
export function barrierApplies(barrier: MiddlewareBarrier, route: string): boolean {
  if (barrier.conditional) return false;
  if (barrier.appliesToAll) return true;

  for (const source of barrier.matchers) {
    const expression = matcherToRegExp(source);
    if (!expression) continue; // unparseable: cannot claim protection
    if (expression.test(route)) return true;
  }
  return false;
}
