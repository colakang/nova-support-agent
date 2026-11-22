// Tiny terminal client for the SSE API — handy for demos and debugging.
//   node --import tsx scripts/chat.ts [--session ses_…] [--chaos '{"toolFailure":"transient"}'] "message 1" "message 2" …
import { type AgentEvent, readSse } from '@sa/shared';

const base = process.env.API_URL ?? 'http://localhost:8080';
const argv = process.argv.slice(2);
let session: string | undefined;
let chaos: string | undefined;
const msgs: string[] = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--session') session = argv[++i];
  else if (argv[i] === '--chaos') chaos = argv[++i];
  else msgs.push(argv[i]!);
}

if (!session) {
  const r = await fetch(`${base}/api/sessions`, { method: 'POST' });
  session = ((await r.json()) as { id: string }).id;
}
console.log(`session ${session}`);
if (chaos) await fetch(`${base}/api/sessions/${session}/chaos`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: chaos });

for (const text of msgs) {
  console.log(`\n\x1b[1m> ${text}\x1b[0m`);
  const res = await fetch(`${base}/api/sessions/${session}/turns`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
  if (!res.ok || !res.body) { console.log('HTTP', res.status, await res.text()); continue; }
  for await (const f of readSse(res.body)) {
    const e = JSON.parse(f.data) as AgentEvent;
    switch (e.type) {
      case 'step.started': console.log(`  ▶ ${e.label}`); break;
      case 'step.completed': console.log(`    ${e.status === 'ok' ? '✓' : e.status === 'blocked' ? '⊘' : '✗'} ${e.name}: ${e.summary} (${e.durationMs}ms)`); break;
      case 'step.retry': console.log(`    ↻ retry ${e.name}: ${e.reason}`); break;
      case 'guardrail': console.log(`    🛡 ${e.check} ${e.decision}${e.score !== undefined ? ` ${e.score}` : ''} — ${e.detail}`); break;
      case 'message.completed': console.log(`\x1b[36m< ${e.message.content}\x1b[0m  [${e.message.kind}${e.message.citations?.length ? ` · ${e.message.citations.map((c) => c.chunkId).join(', ')}` : ''}]`); break;
      case 'escalated': console.log(`  🎫 ${e.ticket.id} (${e.ticket.reason}, ${e.ticket.priority})`); break;
      case 'error': console.log(`  ⚠ ${e.code}: ${e.message}`); break;
      case 'trace': console.log(`  ⏱ ${e.trace.durationMs}ms (first status ${e.trace.firstStatusMs}ms) · ${e.trace.totals.llmCalls} LLM / ${e.trace.totals.toolCalls} tools · ${e.trace.totals.inputTokens}+${e.trace.totals.outputTokens} tok · $${e.trace.totals.costUsd.toFixed(4)} · ${e.trace.outcome}`); break;
    }
  }
}
