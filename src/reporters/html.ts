import type { AccessLevel, ApplicationSecurityModel, EntryPoint, Finding } from "../core/model.js";
import type { SecurityChange } from "../core/diff.js";
import type { Breach } from "../core/contract.js";

/**
 * Presentation only. No security logic lives here.
 *
 * Visual thesis: this is compiler output, not a dashboard. The access lattice
 * from core/access.ts (public < unknown < authenticated < admin) is the spine
 * of the page, because every rule and every diff is ultimately a statement
 * about where an entry point sits on that ladder.
 */

const SEVERITY_ORDER: Record<Finding["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** Mirrors the rank in core/access.ts. Presentation copy of a core fact. */
const LADDER: readonly AccessLevel[] = ["admin", "authenticated", "unknown", "public"];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function styles(): string {
  return `
/* System stacks only. Remote fonts would break the offline guarantee (ADR 0001). */
:root{
  --mono:ui-monospace,"SF Mono",SFMono-Regular,"Cascadia Mono","Roboto Mono",Menlo,Consolas,monospace;
  --sans:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
:root{
  --paper:#f5f3ee; --ink:#1a1a17; --dim:#6b6862; --rule:#d8d4cb; --panel:#faf9f6;
  --exposed:#a8321e; --guarded:#2d6a4f; --partial:#8a6d1f; --inert:#8b8781;
  --mark:#1a1a17;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --paper:#131311; --ink:#eae7e0; --dim:#918d85; --rule:#2e2c28; --panel:#191816;
  --exposed:#e8674c; --guarded:#5fbf92; --partial:#d4a935; --inert:#7a766f;
  --mark:#eae7e0;
}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  margin:0; background:var(--paper); color:var(--ink);
  font:15px/1.6 var(--sans);
  padding:0 24px 80px;
}
.sheet{max-width:1000px;margin:0 auto}

/* ---- masthead: the compiler banner ---- */
.masthead{padding:44px 0 0;border-bottom:2px solid var(--ink);margin-bottom:0}
.tool{
  font-family:var(--mono);
  font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);
  display:flex;gap:14px;flex-wrap:wrap;align-items:baseline;
}
.tool b{color:var(--ink);font-weight:600}
h1{
  font-family:var(--mono);
  font-size:clamp(30px,5.2vw,46px);font-weight:600;letter-spacing:-.035em;
  margin:12px 0 6px;line-height:1.02;
}
.target{
  font-family:var(--mono);font-size:12.5px;
  color:var(--dim);word-break:break-all;padding-bottom:16px;
}

/* ---- verdict line: the one-sentence answer ---- */
.verdict{
  font-size:clamp(17px,2.5vw,21px);line-height:1.4;font-weight:500;
  padding:24px 0;border-bottom:1px solid var(--rule);letter-spacing:-.012em;
}
.verdict .num{font-family:var(--mono);font-weight:600}
.verdict .num.bad{color:var(--exposed)}
.verdict .num.ok{color:var(--guarded)}

/* ---- signature: the access ladder ---- */
.ladder{padding:30px 0 6px}
.rung{
  display:grid;grid-template-columns:132px 1fr auto;gap:16px;align-items:center;
  padding:9px 0;border-bottom:1px solid var(--rule);
}
.rung:last-child{border-bottom:0}
.rung-name{
  font-family:var(--mono);font-size:12px;letter-spacing:.05em;
  text-transform:uppercase;font-weight:500;
}
.rung-name.admin{color:var(--guarded)}
.rung-name.authenticated{color:var(--ink)}
.rung-name.unknown{color:var(--inert)}
.rung-name.public{color:var(--exposed)}
.track{height:20px;display:flex;align-items:center;gap:3px;flex-wrap:wrap}
.tick{width:9px;height:20px;background:var(--inert);opacity:.28}
.tick.admin{background:var(--guarded);opacity:1}
.tick.authenticated{background:var(--ink);opacity:.72}
.tick.unknown{background:var(--inert);opacity:.5}
.tick.public{background:var(--exposed);opacity:1}
.rung-n{font-family:var(--mono);font-size:15px;font-weight:600;min-width:26px;text-align:right}
.rung-n.zero{color:var(--dim);font-weight:400}
.ladder-key{
  font-size:11.5px;color:var(--dim);padding:12px 0 0;
  font-family:var(--mono);letter-spacing:.02em;
}

/* ---- section headings: compiler stage labels ---- */
h2{
  font-family:var(--mono);font-size:11px;font-weight:600;
  letter-spacing:.16em;text-transform:uppercase;color:var(--dim);
  margin:46px 0 0;padding-bottom:9px;border-bottom:1px solid var(--rule);
  display:flex;justify-content:space-between;align-items:baseline;gap:12px;
}
h2 span{font-weight:400;letter-spacing:.06em;text-transform:none;font-size:11.5px}

/* ---- diagnostics: tsc-style, evidence first ---- */
.diag{padding:20px 0;border-bottom:1px solid var(--rule)}
.diag:last-of-type{border-bottom:0}
.diag-head{
  font-family:var(--mono);font-size:12.5px;
  display:flex;gap:9px;flex-wrap:wrap;align-items:baseline;margin-bottom:7px;
}
.sev{font-weight:600;letter-spacing:.06em;text-transform:uppercase;font-size:11px}
.sev.critical{color:var(--exposed)}
.sev.high{color:var(--exposed)}
.sev.medium{color:var(--partial)}
.sev.low{color:var(--dim)}
.code{color:var(--dim)}
.at{color:var(--dim)}
.at b{color:var(--ink);font-weight:500}
.diag-title{font-size:15.5px;font-weight:600;letter-spacing:-.012em;margin-bottom:3px}
.diag-body{color:var(--dim);font-size:14px;max-width:74ch}

/* ---- entry table: a ledger ---- */
.scroll{overflow-x:auto;margin-top:4px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{
  font-family:var(--mono);font-size:10.5px;font-weight:500;
  letter-spacing:.11em;text-transform:uppercase;color:var(--dim);
  text-align:left;padding:12px 14px 8px 0;border-bottom:1px solid var(--rule);white-space:nowrap;
}
td{padding:11px 14px 11px 0;border-bottom:1px solid var(--rule);vertical-align:baseline}
tr:last-child td{border-bottom:0}
.m{font-family:var(--mono);font-size:12.5px}
.verb{font-weight:600;letter-spacing:.03em}
.acc{font-family:var(--mono);font-size:11.5px;font-weight:600;
  letter-spacing:.05em;text-transform:uppercase;white-space:nowrap}
.acc.admin{color:var(--guarded)}
.acc.authenticated{color:var(--ink)}
.acc.unknown{color:var(--inert)}
.acc.public{color:var(--exposed)}
.none{color:var(--exposed);font-style:italic}
.nil{color:var(--inert)}
/* Marks a guard that sits in middleware rather than in the handler body. */
.via{font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);
  border:1px solid var(--rule);border-radius:2px;padding:1px 3px;margin-left:4px;vertical-align:1px}

/* ---- transitions: the diff's reason for existing ---- */
.tr-row{padding:22px 0;border-bottom:1px solid var(--rule)}
.tr-row:last-of-type{border-bottom:0}
.move{
  font-family:var(--mono);font-size:16px;font-weight:600;
  display:flex;align-items:center;gap:11px;flex-wrap:wrap;margin-bottom:8px;
}
.move .to{font-size:19px;line-height:1;color:var(--dim)}
.subject{font-family:var(--mono);font-size:13px;color:var(--dim);word-break:break-all}
.blocking{
  font-family:var(--mono);font-size:10.5px;font-weight:600;
  letter-spacing:.1em;text-transform:uppercase;color:var(--exposed);
  border:1px solid currentColor;padding:1px 6px;
}

/* ---- attack paths: one chain per reachable entry point ---- */
.path{padding:18px 0;border-bottom:1px solid var(--rule)}
.path:last-of-type{border-bottom:0}
.chain{display:flex;align-items:center;flex-wrap:wrap;gap:0;margin-bottom:7px}
.node{
  font-family:var(--mono);font-size:11.5px;letter-spacing:.03em;
  padding:4px 9px;border:1px solid var(--rule);white-space:nowrap;
}
.node.origin{color:var(--dim)}
.node.entry{color:var(--ink);font-weight:600;border-color:var(--ink)}
.node.barrier{color:var(--guarded);border-color:currentColor}
.node.gap{color:var(--exposed);border-style:dashed;border-color:currentColor;font-weight:600}
.node.sink{color:var(--partial);border-color:currentColor;margin-left:3px}
.node.inert{color:var(--inert);border-style:dotted}
.link{width:18px;height:1px;background:var(--rule);flex:0 0 18px}
.path.open .link{background:var(--exposed);opacity:.55}
.path-meta{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;font-size:11.5px}
.path-meta .at{font-family:var(--mono)}

/* ---- clean state ---- */
.clean{padding:40px 0;border-bottom:1px solid var(--rule)}
.clean-mark{font-family:var(--mono);font-size:26px;color:var(--guarded);margin-bottom:8px}
.clean p{margin:0;color:var(--dim);font-size:14.5px;max-width:64ch}

/* ---- colophon ---- */
.colophon{
  margin-top:52px;padding-top:16px;border-top:2px solid var(--ink);
  font-family:var(--mono);font-size:11px;line-height:1.75;
  color:var(--dim);display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;
}
.colophon p{margin:0;max-width:56ch}

@media (max-width:620px){
  .rung{grid-template-columns:96px 1fr auto;gap:11px}
  .rung-name{font-size:11px}
  th,td{padding-right:10px}
}
@media print{body{background:#fff}.sheet{max-width:none}}
`;
}

/* ------------------------------------------------------------------ */

function countBy(entries: EntryPoint[]): Record<AccessLevel, number> {
  const counts: Record<AccessLevel, number> = { public: 0, unknown: 0, authenticated: 0, admin: 0 };
  for (const entry of entries) counts[entry.inferredAccess] += 1;
  return counts;
}

function renderLadder(entries: EntryPoint[]): string {
  const counts = countBy(entries);
  const rungs = LADDER.map((level) => {
    const n = counts[level];
    const ticks = Array.from({ length: n }, () => `<i class="tick ${level}"></i>`).join("");
    return `<div class="rung">
<div class="rung-name ${level}">${level}</div>
<div class="track">${ticks || `<i class="tick"></i>`}</div>
<div class="rung-n${n === 0 ? " zero" : ""}">${n}</div>
</div>`;
  }).join("\n");

  return `<div class="ladder">${rungs}
<div class="ladder-key">strongest guard at top &middot; a change that moves an entry point downward is a regression</div>
</div>`;
}

function renderVerdict(model: ApplicationSecurityModel): string {
  const exposed = model.entryPoints.filter((entry) => entry.inferredAccess === "public").length;
  const total = model.entryPoints.length;

  if (total === 0) {
    return `<div class="verdict">No entry points were discovered in this tree. Either the target is not a Next.js App Router project, or its routes live elsewhere.</div>`;
  }
  if (exposed === 0) {
    return `<div class="verdict">All <span class="num ok">${total}</span> entry points carry a detected authorization signal.</div>`;
  }
  return `<div class="verdict"><span class="num bad">${exposed}</span> of <span class="num">${total}</span> entry ${
    total === 1 ? "point reaches" : "points reach"
  } sensitive behavior with no authorization signal detected in ${exposed === 1 ? "its" : "their"} body.</div>`;
}

function renderDiagnostic(finding: Finding): string {
  return `<div class="diag">
<div class="diag-head">
<span class="sev ${finding.severity}">${finding.severity}</span>
<span class="code">${escapeHtml(finding.ruleId)}</span>
<span class="at">at <b>${escapeHtml(finding.location.file)}</b>:${finding.location.line}</span>
</div>
<div class="diag-title">${escapeHtml(finding.title)}</div>
<div class="diag-body">${escapeHtml(finding.message)}</div>
</div>`;
}

function renderRow(entry: EntryPoint): string {
  const verb = entry.method ?? (entry.kind === "server-action" ? "action" : entry.kind);
  const guards =
    entry.authSignals.length > 0
      ? entry.authSignals
          .map((signal) =>
            // A middleware guard is in another file and invisible in the
            // handler. Rendering it like an inline call would tell a reviewer
            // to look somewhere the barrier is not.
            signal.source === "middleware"
              ? `${escapeHtml(`${signal.name}()`)}<span class="via">middleware</span>`
              : escapeHtml(`${signal.name}()`),
          )
          .join(" ")
      : `<span class="none">none detected</span>`;
  const ops =
    entry.sensitiveOperations.length > 0
      ? [...new Set(entry.sensitiveOperations.map((operation) => operation.category))]
          .map((category) => escapeHtml(category))
          .join(" ")
      : `<span class="nil">&mdash;</span>`;
  return `<tr>
<td class="m verb">${escapeHtml(verb)}</td>
<td class="m">${escapeHtml(entry.route ?? entry.exportName)}</td>
<td><span class="acc ${entry.inferredAccess}">${entry.inferredAccess}</span></td>
<td class="m">${guards}</td>
<td class="m">${ops}</td>
<td class="m at">${escapeHtml(entry.location.file)}:${entry.location.line}</td>
</tr>`;
}

function shell(title: string, inner: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>${styles()}</style></head>
<body><div class="sheet">${inner}</div></body></html>`;
}

function colophon(note: string): string {
  return `<div class="colophon">
<p>${note}</p>
<p>detent &middot; schema v1<br>parsed, never executed</p>
</div>`;
}

/* ------------------------------------------------------------------ */

export function renderModelHtml(model: ApplicationSecurityModel): string {
  const findings = [...model.findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  const diagnostics =
    findings.length > 0
      ? findings.map(renderDiagnostic).join("\n")
      : `<div class="clean"><div class="clean-mark">&#10003;</div>
<p>No rule fired. Every discovered entry point carries an authorization signal, and no environment variable crosses the client boundary unsafely.</p></div>`;

  const table =
    model.entryPoints.length > 0
      ? `<div class="scroll"><table>
<thead><tr><th>Verb</th><th>Route / export</th><th>Access</th><th>Guards</th><th>Sensitive</th><th>Source</th></tr></thead>
<tbody>${model.entryPoints.map(renderRow).join("\n")}</tbody></table></div>`
      : "";

  const inner = `<header class="masthead">
<div class="tool"><b>detent</b><span>inspect</span><span>${escapeHtml(model.framework.name)} &middot; ${Math.round(model.framework.confidence * 100)}% confidence</span></div>
<h1>Application<br>Security Model</h1>
<div class="target">${escapeHtml(model.root)}</div>
</header>

${renderVerdict(model)}

<h2>Access lattice <span>${model.entryPoints.length} entry points</span></h2>
${renderLadder(model.entryPoints)}

<h2>Diagnostics <span>${model.findings.length} ${model.findings.length === 1 ? "rule fired" : "rules fired"}</span></h2>
${diagnostics}

${model.entryPoints.length > 0 ? `<h2>Entry points <span>${model.clientBoundaries.length} client boundaries &middot; ${model.environment.length} env reads</span></h2>\n${table}` : ""}

${colophon("Access levels are inferred from naming heuristics over parsed source. A guard this build does not recognize reads as <em>none detected</em>. Treat a finding as a question, not a verdict.")}`;

  return shell("Application Security Model", inner);
}

export function renderDiffHtml(changes: SecurityChange[], root: string): string {
  const blocking = changes.filter(
    (change) => change.severity === "critical" || change.severity === "high",
  );

  const verdict =
    changes.length === 0
      ? `<div class="verdict">Nothing moved. The security model is identical to the recorded baseline.</div>`
      : blocking.length > 0
        ? `<div class="verdict"><span class="num bad">${blocking.length}</span> of <span class="num">${changes.length}</span> ${changes.length === 1 ? "change" : "changes"} ${blocking.length === 1 ? "weakens" : "weaken"} the model. This build exits <span class="num bad">1</span>.</div>`
        : `<div class="verdict"><span class="num">${changes.length}</span> ${changes.length === 1 ? "change" : "changes"} recorded, none weakening. This build exits <span class="num ok">0</span>.</div>`;

  const body =
    changes.length === 0
      ? `<div class="clean"><div class="clean-mark">&#61;</div>
<p>No entry point changed access level, no entry point appeared, and no secret-shaped variable crossed into a client module.</p></div>`
      : changes
          .map((change) => {
            if (change.type === "access-broadened") {
              return `<div class="tr-row">
<div class="move"><span class="acc ${change.before}">${escapeHtml(change.before)}</span>
<span class="to">&rarr;</span>
<span class="acc ${change.after}">${escapeHtml(change.after)}</span>
<span class="blocking">blocking</span></div>
<div class="subject">${escapeHtml(change.id)}</div>
</div>`;
            }
            if (change.type === "client-secret-exposure-added") {
              return `<div class="tr-row">
<div class="move"><span class="acc public">server</span>
<span class="to">&rarr;</span>
<span class="acc public">client</span>
<span class="blocking">blocking</span></div>
<div class="subject">${escapeHtml(change.variable)} &middot; ${escapeHtml(change.file)}</div>
</div>`;
            }
            return `<div class="tr-row">
<div class="move"><span class="acc unknown">absent</span>
<span class="to">&rarr;</span>
<span class="acc ${change.entryPoint.inferredAccess}">${change.entryPoint.inferredAccess}</span></div>
<div class="subject">${escapeHtml(change.entryPoint.id)}</div>
</div>`;
          })
          .join("\n");

  const inner = `<header class="masthead">
<div class="tool"><b>detent</b><span>diff</span><span>against recorded baseline</span></div>
<h1>Security<br>Diff</h1>
<div class="target">${escapeHtml(root)}</div>
</header>

${verdict}

<h2>Transitions <span>${changes.length} recorded &middot; ${blocking.length} blocking</span></h2>
${body}

${colophon("A transition is blocking when it moves an entry point down the access lattice or opens a new path to the client &mdash; the slip a detent is meant to catch. Additions are recorded but do not fail the build.")}`;

  return shell("Security Diff", inner);
}

/* ------------------------------------------------------------------ */

export function renderContractHtml(breaches: Breach[], required: number, root: string): string {
  const verdict =
    breaches.length === 0
      ? `<div class="verdict">All <span class="num ok">${required}</span> declared ${required === 1 ? "requirement holds" : "requirements hold"}.</div>`
      : `<div class="verdict"><span class="num bad">${breaches.length}</span> of <span class="num">${required}</span> declared ${required === 1 ? "requirement is" : "requirements are"} breached. This build exits <span class="num bad">1</span>.</div>`;

  const body =
    breaches.length === 0
      ? `<div class="clean"><div class="clean-mark">&#10003;</div>
<p>Every invariant the team declared is satisfied by the current model.</p></div>`
      : breaches
          .map(
            (breach) => `<div class="diag">
<div class="diag-head">
<span class="sev critical">breach</span>
<span class="code">${escapeHtml(breach.rule)}</span>
<span class="at">at <b>${escapeHtml(breach.location.file)}</b>:${breach.location.line}</span>
</div>
<div class="diag-title">${escapeHtml(breach.expectation)}</div>
<div class="diag-body">Model shows ${escapeHtml(breach.actual)} &mdash; ${escapeHtml(breach.subject)}</div>
</div>`,
          )
          .join("\n");

  const inner = `<header class="masthead">
<div class="tool"><b>detent</b><span>contract</span><span>declared invariants</span></div>
<h1>Security<br>Contract</h1>
<div class="target">${escapeHtml(root)}</div>
</header>

${verdict}

<h2>Requirements <span>${required} declared &middot; ${breaches.length} breached</span></h2>
${body}

${colophon("A finding is the tool's opinion. A requirement is the team's decision, so a breach fails the build rather than asking for review.")}`;

  return shell("Security Contract", inner);
}

/* ------------------------------------------------------------------ */

/**
 * Attack-path view.
 *
 * The tables answer "what exists". This answers "what can be reached, and what
 * stands in the way". Every row is one path: an origin, the barrier (or the gap
 * where a barrier should be), the entry point, and what it ultimately touches.
 */
export function renderGraphHtml(model: ApplicationSecurityModel): string {
  const paths = model.entryPoints
    .map((entry) => {
      const reaches = [...new Set(entry.sensitiveOperations.map((operation) => operation.category))];
      return { entry, reaches };
    })
    // Unguarded paths that reach something sensitive are the whole point: first.
    .sort((a, b) => {
      const weight = (item: typeof a) =>
        (item.entry.inferredAccess === "public" ? 0 : 2) + (item.reaches.length > 0 ? 0 : 1);
      return weight(a) - weight(b) || a.entry.id.localeCompare(b.entry.id);
    });

  const open = paths.filter(
    (item) => item.entry.inferredAccess === "public" && item.reaches.length > 0,
  ).length;

  const verdict =
    model.entryPoints.length === 0
      ? `<div class="verdict">No entry points were discovered, so there is no path to draw.</div>`
      : open === 0
        ? `<div class="verdict">Every path that reaches a sensitive operation passes a barrier.</div>`
        : `<div class="verdict"><span class="num bad">${open}</span> ${open === 1 ? "path reaches" : "paths reach"} a sensitive operation with no barrier in between.</div>`;

  const rows = paths
    .map((item) => {
      const { entry, reaches } = item;
      const guarded = entry.authSignals.length > 0;
      const barrier = guarded
        ? `<span class="node barrier">${escapeHtml(entry.authSignals.map((signal) => signal.name)[0] ?? "guard")}()</span>`
        : `<span class="node gap">no barrier</span>`;
      const sink =
        reaches.length > 0
          ? reaches.map((category) => `<span class="node sink">${escapeHtml(category)}</span>`).join("")
          : `<span class="node inert">no sensitive operation</span>`;
      const exposed = entry.inferredAccess === "public" && reaches.length > 0;

      return `<div class="path${exposed ? " open" : ""}">
<div class="chain">
<span class="node origin">${entry.kind === "route-handler" ? "network" : "client"}</span>
<span class="link"></span>
${barrier}
<span class="link"></span>
<span class="node entry">${escapeHtml(entry.method ?? "action")} ${escapeHtml(entry.route ?? entry.exportName)}</span>
<span class="link"></span>
${sink}
</div>
<div class="path-meta"><span class="acc ${entry.inferredAccess}">${entry.inferredAccess}</span>
<span class="at">${escapeHtml(entry.location.file)}:${entry.location.line}</span></div>
</div>`;
    })
    .join("\n");

  const boundaries =
    model.clientBoundaries.length > 0
      ? `<h2>Client boundary <span>${model.clientBoundaries.length} ${model.clientBoundaries.length === 1 ? "module ships" : "modules ship"} to the browser</span></h2>
<div class="scroll"><table><thead><tr><th>Module</th><th>Exports</th></tr></thead><tbody>
${model.clientBoundaries
  .map(
    (boundary) => `<tr><td class="m">${escapeHtml(boundary.file)}</td>
<td class="m">${boundary.exportedNames.length > 0 ? escapeHtml(boundary.exportedNames.join(" ")) : `<span class="nil">&mdash;</span>`}</td></tr>`,
  )
  .join("\n")}
</tbody></table></div>`
      : "";

  const inner = `<header class="masthead">
<div class="tool"><b>detent</b><span>graph</span><span>${model.entryPoints.length} paths</span></div>
<h1>Attack<br>Paths</h1>
<div class="target">${escapeHtml(model.root)}</div>
</header>

${verdict}

<h2>Reachability <span>origin &rarr; barrier &rarr; entry point &rarr; effect</span></h2>
${model.entryPoints.length > 0 ? rows : `<div class="clean"><div class="clean-mark">&#8709;</div><p>Nothing to draw.</p></div>`}

${boundaries}

${colophon("A path is drawn from parsed evidence only. A barrier this build does not recognize appears as a gap, so read a gap as a question about the guard, not proof of exposure.")}`;

  return shell("Attack Paths", inner);
}
