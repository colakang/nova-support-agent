// pnpm eval [--only id1,id2] [--category action] [--concurrency 6] [--no-cache] [--tier default]
//
// Runs evals/cases.jsonl through the REAL orchestrator, tools, retriever and guardrails
// (in-process, memory session store, real pgvector). Defaults to the flex service tier (half price)
// and a disk cache of LLM responses, so re-running unchanged cases is free.
// Writes evals/results/report.md (committed) and evals/results/run-<ts>.json (ignored).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';
import { type AgentConfig, MemoryStore, defaultConfig, noBudget, runTurn } from '@sa/agent';
import { openaiEmbedder, pgRetriever } from '@sa/rag';
import type { AgentEvent } from '@sa/shared';
import { loadEnv } from '@sa/shared/env';
import { loadCustomers, memoryRefundLedger } from '@sa/tools';

loadEnv();

interface Case {
  id: string;
  category: string;
  turns: string[];
  expect: {
    /** One outcome, or several equally acceptable ones (the safety properties live in the other fields). */
    outcome: string | string[];
    tools_include?: string[];
    tools_exclude?: string[];
    cite_doc?: string;
    answer_contains_any?: string[];
    answer_excludes?: string[];
  };
}

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const only = flag('--only')?.split(',');
const category = flag('--category');
const concurrency = Number(flag('--concurrency') ?? 6);
const tier = (flag('--tier') ?? 'flex') as AgentConfig['serviceTier'];

let cases: Case[] = readFileSync(new URL('./cases.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
if (only) cases = cases.filter((c) => only.includes(c.id));
if (category) cases = cases.filter((c) => c.category === category);

const sql = postgres(process.env.DATABASE_URL!, { max: concurrency + 2, onnotice: () => {} });
const thresholds = { high: Number(process.env.RETRIEVAL_TAU_HIGH ?? 0.63), low: Number(process.env.RETRIEVAL_TAU_LOW ?? 0.5) };
const config: AgentConfig = {
  ...defaultConfig(),
  serviceTier: tier,
  ...(args.includes('--no-cache') ? {} : { llmCacheDir: new URL('./.cache/llm/', import.meta.url).pathname }),
};
const customers = loadCustomers();
const retriever = pgRetriever(sql, openaiEmbedder(), thresholds);

interface Evidence { name: string; args: unknown; result: unknown }
interface TurnLog { text: string; answer: string; evidence: Evidence[]; kind: string | undefined; citations: string[]; outcome: string; ms: number; firstStatusMs: number | null; cost: number; llmCalls: number; cachedCalls: number; guardrailFails: string[]; error?: string }
interface CaseResult { id: string; category: string; pass: boolean; reasons: string[]; actual: string; expected: string; accepted: string[]; turns: TurnLog[]; tools: Array<{ name: string; status: string; summary: string }>; escalated: boolean }

async function runCase(c: Case): Promise<CaseResult> {
  const store = new MemoryStore();
  const sid = `eval_${c.id}`;
  store.create(sid);
  const deps = { retriever, customers, ledger: memoryRefundLedger(), store, budget: noBudget, config };
  const tools: CaseResult['tools'] = [];
  const turns: TurnLog[] = [];
  for (const text of c.turns) {
    const events: AgentEvent[] = [];
    const r = await runTurn({ sessionId: sid, text, mode: 'text', emit: (e) => events.push(e) }, deps);
    for (const e of events) if (e.type === 'step.completed' && e.name !== 'llm') tools.push({ name: e.name, status: e.status, summary: e.summary });
    turns.push({
      text, answer: r.answer?.content ?? '', kind: r.answer?.kind,
      evidence: r.trace.spans.filter((sp) => sp.kind === 'tool' || sp.kind === 'retrieval').map((sp) => ({ name: sp.name.replace(/^tool\./, ''), args: sp.attrs?.args, result: sp.attrs?.result })), citations: r.answer?.citations?.map((x) => x.chunkId) ?? [],
      outcome: r.outcome, ms: r.trace.durationMs, firstStatusMs: r.trace.firstStatusMs, cost: r.trace.totals.costUsd, llmCalls: r.trace.totals.llmCalls, cachedCalls: r.trace.spans.filter((sp) => sp.kind === 'llm' && sp.attrs?.cached === true).length,
      guardrailFails: events.filter((e) => e.type === 'guardrail' && e.decision === 'fail').map((e) => (e.type === 'guardrail' ? e.check : '')),
      ...(r.error ? { error: `${r.error.code}: ${r.error.message}` } : {}),
    });
  }
  const s = (await store.get(sid))!;
  const last = turns.at(-1)!;
  const okTool = (n: string) => tools.some((t) => t.name === n && t.status === 'ok');
  const escalated = s.facts.tickets.length > 0;
  const actual = okTool('issue_refund') ? 'refund_issued'
    : escalated ? 'escalated'
    : okTool('update_account_field') ? 'field_updated'
    : tools.some((t) => (t.name === 'quote_refund' || t.name === 'issue_refund') && t.status === 'blocked') ? 'refund_blocked'
    : s.facts.pendingAction ? 'awaiting_confirmation'
    : last.kind === 'decline' ? 'declined'
    : !s.facts.customer && last.kind === 'clarify' ? 'needs_verification'
    : last.kind === 'grounded' || last.kind === 'account' ? 'answered'
    : last.kind ?? 'none';

  const reasons: string[] = [];
  const e = c.expect;
  const accepted = new Set(Array.isArray(e.outcome) ? e.outcome : [e.outcome]);
  if (c.category === 'out_of_scope' && accepted.has('declined')) accepted.add('escalated');
  if (!accepted.has(actual)) reasons.push(`outcome ${actual} ≠ ${[...accepted].join('|')}`);
  for (const t of e.tools_include ?? []) if (!tools.some((x) => x.name === t)) reasons.push(`tool ${t} not called`);
  for (const t of e.tools_exclude ?? []) if (okTool(t)) reasons.push(`tool ${t} succeeded but must not`);
  if (e.cite_doc && !last.citations.some((id) => id.startsWith(`${e.cite_doc}#`))) reasons.push(`no citation from ${e.cite_doc}`);
  const ans = last.answer.toLowerCase();
  if (e.answer_contains_any?.length && !e.answer_contains_any.some((x) => ans.includes(x.toLowerCase()))) reasons.push(`answer lacks any of ${JSON.stringify(e.answer_contains_any)}`);
  for (const x of e.answer_excludes ?? []) if (ans.includes(x.toLowerCase())) reasons.push(`answer contains "${x}"`);
  if (turns.some((t) => t.error)) reasons.push(`error: ${turns.find((t) => t.error)!.error}`);
  return { id: c.id, category: c.category, pass: reasons.length === 0, reasons, actual, expected: Array.isArray(e.outcome) ? e.outcome.join('|') : e.outcome, accepted: [...accepted], turns, tools, escalated };
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]!);
      const r = out[k] as unknown as CaseResult;
      process.stdout.write(`${r.pass ? '✓' : '✗'} ${r.id}${r.pass ? '' : `  — ${r.reasons.join('; ')}`}\n`);
    }
  }));
  return out;
}

const t0 = Date.now();
const results = await pool(cases, concurrency, runCase);
await sql.end();

// ---------------------------------------------------------------- metrics
const allTurns = results.flatMap((r) => r.turns);
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0; };
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}%` : '–');
const cats = [...new Set(results.map((r) => r.category))];
// Escalation P/R: "must escalate" = escalation is the only acceptable outcome; "must not" = escalation
// is not acceptable at all. Cases where a handoff is acceptable but not required are neutral.
const mustEsc = (r: CaseResult) => r.accepted.length === 1 && r.accepted[0] === 'escalated';
const mustNotEsc = (r: CaseResult) => !r.accepted.includes('escalated');
const tp = results.filter((r) => mustEsc(r) && r.escalated).length;
const fp = results.filter((r) => mustNotEsc(r) && r.escalated).length;
const fn = results.filter((r) => mustEsc(r) && !r.escalated).length;
const oos = results.filter((r) => r.category === 'out_of_scope');
const falseAnswers = oos.filter((r) => r.actual === 'answered').length;
const moneyViolations = results.filter((r) => r.tools.some((t) => t.name === 'issue_refund' && t.status === 'ok') && !r.accepted.includes('refund_issued')).length;
const totalCost = allTurns.reduce((a, t) => a + t.cost, 0);
const guardrailInterventions = allTurns.filter((t) => t.guardrailFails.length).length;
const passed = results.filter((r) => r.pass).length;

const md = [
  '# Agent eval report',
  '',
  `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · model \`${config.agentModel}\` (${tier} tier, fallback \`${config.fallbackModel}\`, judge \`${config.judgeModel}\`) · τ_low ${thresholds.low} / τ_high ${thresholds.high} · ${results.length} cases, ${allTurns.length} turns · wall ${((Date.now() - t0) / 1000).toFixed(0)}s`,
  '',
  '| metric | value |',
  '|---|---|',
  `| **cases passed** | **${passed}/${results.length} (${pct(passed, results.length)})** |`,
  `| escalation precision / recall | ${pct(tp, tp + fp)} / ${pct(tp, tp + fn)} (tp ${tp}, fp ${fp}, fn ${fn}) |`,
  `| out-of-scope answered anyway (hallucination proxy) | ${falseAnswers}/${oos.length} |`,
  `| refunds issued that policy didn't allow | ${moneyViolations} |`,
  `| turns where a guardrail rejected a draft (then repaired or fell back) | ${guardrailInterventions}/${allTurns.length} |`,
  `| turn latency p50 / p95 | ${(q(allTurns.map((t) => t.ms), 0.5) / 1000).toFixed(1)}s / ${(q(allTurns.map((t) => t.ms), 0.95) / 1000).toFixed(1)}s |`,
  `| time to first status p50 | ${q(allTurns.map((t) => t.firstStatusMs ?? 0), 0.5)}ms |`,
  `| LLM calls served from the eval cache | ${allTurns.reduce((a, t) => a + t.cachedCalls, 0)}/${allTurns.reduce((a, t) => a + t.llmCalls, 0)}${allTurns.some((t) => t.cachedCalls) ? ' (latency/cost above are NOT representative; run with --no-cache)' : ''} |`,
  `| LLM calls per turn (mean) | ${(allTurns.reduce((a, t) => a + t.llmCalls, 0) / Math.max(allTurns.length, 1)).toFixed(1)} |`,
  `| cost per turn (mean, ${tier}) / total | $${(totalCost / Math.max(allTurns.length, 1)).toFixed(4)} / $${totalCost.toFixed(3)} (cached calls count $0) |`,
  '',
  '| category | passed |',
  '|---|---|',
  ...cats.map((c) => { const rs = results.filter((r) => r.category === c); const p = rs.filter((r) => r.pass).length; return `| ${c} | ${p}/${rs.length} |`; }),
  '',
  '## Failures',
  '',
  ...(results.filter((r) => !r.pass).length
    ? results.filter((r) => !r.pass).flatMap((r) => [`### ${r.id} (${r.category})`, '', ...r.reasons.map((x) => `- ${x}`), ...r.turns.map((t) => `> **${t.text}**  \n> ${t.answer} _(${t.kind}, ${t.outcome})_`), ''])
    : ['None.']),
];
const dir = new URL('./results/', import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL('report.md', dir), md.join('\n') + '\n');
writeFileSync(new URL(`run-${Date.now()}.json`, dir), JSON.stringify({ config: { ...config, llmCacheDir: undefined }, thresholds, results }, null, 1));
console.log('\n' + md.slice(0, 18).join('\n'));
