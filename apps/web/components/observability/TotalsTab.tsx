'use client';
import type { TurnTrace } from '@sa/shared';
import type { Budget, DemoInfo } from '@/lib/api';
import { avg, fmtMs, fmtTokens, fmtUsd } from '@/lib/format';
import { Meter, SectionTitle, Stat } from './bits';
import { OutcomeBadge } from './TurnsTab';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const nums = (xs: Array<number | null>) => xs.filter((x): x is number => x !== null);

export function TotalsTab({ traces, budget, demo }: { traces: TurnTrace[]; budget: Budget | null; demo: DemoInfo | null }) {
  const agent = traces.filter((t) => t.outcome !== 'voice_usage');
  const voice = traces.filter((t) => t.outcome === 'voice_usage');
  const agentCost = sum(agent.map((t) => t.totals.costUsd));
  const voiceCost = sum(voice.map((t) => t.totals.costUsd));
  const sessionCost = agentCost + voiceCost;
  const outcomes = new Map<string, number>();
  for (const t of agent) outcomes.set(t.outcome, (outcomes.get(t.outcome) ?? 0) + 1);

  return (
    <div className="text-[12.5px]">
      <SectionTitle>This session</SectionTitle>
      <div className="grid grid-cols-3 gap-1.5">
        <Stat label="Est. cost" value={fmtUsd(sessionCost)} />
        <Stat label="Agent cost" value={fmtUsd(agentCost)} hint="Chat turns + voice consults" />
        <Stat label="Voice cost" value={fmtUsd(voiceCost)} hint="Audio tokens reported by the browser" />
        <Stat label="Tokens in" value={fmtTokens(sum(traces.map((t) => t.totals.inputTokens)))} />
        <Stat label="Tokens out" value={fmtTokens(sum(traces.map((t) => t.totals.outputTokens)))} />
        <Stat label="Agent turns" value={agent.length} hint="Chat turns + voice consults" />
        <Stat label="LLM calls" value={sum(agent.map((t) => t.totals.llmCalls))} />
        <Stat label="Tool calls" value={sum(agent.map((t) => t.totals.toolCalls))} />
        <Stat label="Voice segs" value={voice.length} />
      </div>

      <SectionTitle>Latency (avg)</SectionTitle>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <Stat label="End-to-end" value={fmtMs(avg(agent.map((t) => t.durationMs)))} />
        <Stat label="First status" value={fmtMs(avg(nums(agent.map((t) => t.firstStatusMs))))} />
        <Stat label="Answer ready" value={fmtMs(avg(nums(agent.map((t) => t.answerReadyMs))))} />
        <Stat label="Voice reply" value={fmtMs(avg(nums(voice.map((t) => t.answerReadyMs))))} hint="Speech end → Nova's first audio" />
      </div>

      {outcomes.size ? (
        <>
          <SectionTitle>Outcomes</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {[...outcomes].map(([o, n]) => (
              <span key={o} className="inline-flex items-center gap-1">
                <OutcomeBadge outcome={o} />
                <span className="font-mono text-[11px] text-muted">×{n}</span>
              </span>
            ))}
          </div>
        </>
      ) : null}

      <SectionTitle>Spend caps</SectionTitle>
      {budget ? (
        <div className="space-y-3">
          <div>
            <div className="mb-1 flex justify-between text-xs">
              <span className="text-fg-2">Today, all sessions</span>
              <span className="font-mono tabular-nums text-muted">
                {fmtUsd(budget.todayUsd)} / {fmtUsd(budget.dailyCapUsd)}
              </span>
            </div>
            <Meter value={budget.todayUsd} max={budget.dailyCapUsd} label="Daily spend" />
          </div>
          <div>
            <div className="mb-1 flex justify-between text-xs">
              <span className="text-fg-2">This session</span>
              <span className="font-mono tabular-nums text-muted">
                {fmtUsd(sessionCost)} / {fmtUsd(budget.sessionCapUsd)}
              </span>
            </div>
            <Meter value={sessionCost} max={budget.sessionCapUsd} label="Session spend" />
          </div>
        </div>
      ) : (
        <p className="text-muted">Budget unavailable.</p>
      )}

      <SectionTitle>Retrieval thresholds</SectionTitle>
      {demo ? (
        <div className="grid grid-cols-2 gap-1.5">
          <Stat label="High threshold" value={demo.thresholds.high.toFixed(2)} hint="At or above: answer may be grounded directly" />
          <Stat label="Low threshold" value={demo.thresholds.low.toFixed(2)} hint="Below: passages withheld; between: grounding judge checks" />
        </div>
      ) : (
        <p className="text-muted">Unavailable.</p>
      )}
      <p className="mt-4 text-[11px] text-faint">Costs are estimates from the shared price table (standard tier); the server enforces the caps.</p>
    </div>
  );
}
