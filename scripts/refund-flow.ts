// pnpm refund-flow — runs the two-phase refund SOP end to end, in-process (no API server needed):
//   verify → policy → quote (no money moves) → customer confirms in the NEXT message → refund.
// Uses the real orchestrator, tools, retriever and guardrails against DATABASE_URL.
import postgres from 'postgres';
import { MemoryStore, defaultConfig, noBudget, runTurn } from '@sa/agent';
import { openaiEmbedder, pgRetriever } from '@sa/rag';
import { type AgentEvent, redactPins } from '@sa/shared';
import { loadEnv } from '@sa/shared/env';
import { loadCustomers, memoryRefundLedger } from '@sa/tools';

loadEnv();
const sql = postgres(process.env.DATABASE_URL!, { max: 2, onnotice: () => {} });
const store = new MemoryStore();
store.create('demo');
const deps = {
  retriever: pgRetriever(sql, openaiEmbedder(), { high: Number(process.env.RETRIEVAL_TAU_HIGH ?? 0.63), low: Number(process.env.RETRIEVAL_TAU_LOW ?? 0.5) }),
  customers: loadCustomers(), ledger: memoryRefundLedger(), store, budget: noBudget, config: defaultConfig(),
};
const turns = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["Hi, I'd like a refund for my most recent invoice.", 'maya@brightloop.io, PIN 4821', "We didn't end up using it last month. Yes, go ahead."];

for (const text of turns) {
  console.log(`\n> ${redactPins(text)}`);
  const r = await runTurn({
    sessionId: 'demo', text, mode: 'text',
    emit: (e: AgentEvent) => {
      if (e.type === 'step.completed' && e.name !== 'llm') console.log(`  ▶ ${e.name.padEnd(24)} ${e.status === 'ok' ? '✓' : '⊘'} ${e.summary}`);
      if (e.type === 'guardrail') console.log(`    🛡 ${e.check} ${e.decision}${e.score !== undefined ? ` ${e.score}` : ''} — ${e.detail.slice(0, 100)}`);
    },
  }, deps);
  console.log(`< ${r.answer?.content ?? `(error: ${r.error?.message})`}`);
  console.log(`  ⏱ ${(r.trace.durationMs / 1000).toFixed(1)}s · ${r.trace.totals.llmCalls} LLM / ${r.trace.totals.toolCalls} tools · $${r.trace.totals.costUsd.toFixed(4)} · ${r.outcome}`);
}
await sql.end();
