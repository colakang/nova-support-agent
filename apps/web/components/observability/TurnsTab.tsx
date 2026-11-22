'use client';
import { useState } from 'react';
import { AudioLines, ChevronDown, ChevronRight, MessageSquare, Mic } from 'lucide-react';
import type { TurnTrace } from '@sa/shared';
import type { GuardrailEvent } from '@/lib/turnActivity';
import { fmtMs, fmtTokens, fmtUsd, humanize } from '@/lib/format';
import { Badge, type Tone } from '@/components/ui/primitives';
import { GuardrailChip } from '@/components/chat/GuardrailChips';
import { JsonBlock, Stat } from './bits';
import { Waterfall } from './Waterfall';

const OUTCOME_TONE: Record<string, Tone> = {
  answered: 'ok',
  refund_issued: 'ok',
  field_updated: 'ok',
  escalated: 'esc',
  error: 'bad',
  aborted: 'neutral',
  needs_verification: 'warn',
  refund_blocked: 'warn',
  declined: 'warn',
  voice_usage: 'info',
};

export function OutcomeBadge({ outcome }: { outcome: string }) {
  return <Badge tone={OUTCOME_TONE[outcome] ?? 'neutral'}>{outcome === 'voice_usage' ? 'voice usage' : humanize(outcome).toLowerCase()}</Badge>;
}

function VoiceUsageCard({ trace }: { trace: TurnTrace }) {
  const [open, setOpen] = useState(false);
  const attrs = trace.spans[0]?.attrs;
  const lat = attrs && Array.isArray(attrs.latencyMs) ? attrs.latencyMs.filter((x): x is number => typeof x === 'number') : [];
  return (
    <article className="rounded-xl border border-line bg-surface p-3">
      <div className="flex items-center gap-2">
        <AudioLines aria-hidden className="size-4 shrink-0 text-info" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">Realtime audio segment</span>
        <OutcomeBadge outcome={trace.outcome} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5 min-[420px]:grid-cols-3">
        <Stat label="Tokens in" value={fmtTokens(trace.totals.inputTokens)} />
        <Stat label="Tokens out" value={fmtTokens(trace.totals.outputTokens)} />
        <Stat label="Est. cost" value={fmtUsd(trace.totals.costUsd)} />
        <Stat label="Responses" value={lat.length || '—'} hint="Responses with a measured latency" />
        <Stat label="Avg latency" value={fmtMs(trace.answerReadyMs)} hint="Speech end → first audio, averaged" />
        <Stat label="Model" value={trace.spans[0]?.model ?? '—'} />
      </div>
      {attrs ? (
        <div className="mt-2">
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-1 text-xs font-medium text-muted hover:text-fg">
            {open ? <ChevronDown aria-hidden className="size-3.5" /> : <ChevronRight aria-hidden className="size-3.5" />}
            Usage breakdown
          </button>
          {open ? (
            <div className="mt-1.5">
              <JsonBlock value={attrs} maxHeight="max-h-56" />
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function TurnCard({ trace, guardrails, open, onToggle }: { trace: TurnTrace; guardrails: GuardrailEvent[]; open: boolean; onToggle: () => void }) {
  if (trace.outcome === 'voice_usage') return <VoiceUsageCard trace={trace} />;
  const t = trace.totals;
  const ModeIcon = trace.mode === 'voice' ? Mic : MessageSquare;
  return (
    <article className="rounded-xl border border-line bg-surface p-3">
      <div className="flex items-start gap-2">
        <ModeIcon aria-label={trace.mode === 'voice' ? 'Voice consult' : 'Chat turn'} className="mt-0.5 size-4 shrink-0 text-muted" />
        <p className="line-clamp-2 min-w-0 flex-1 text-[13px] font-medium text-fg" title={trace.userText}>
          {trace.userText}
        </p>
        <OutcomeBadge outcome={trace.outcome} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5 min-[420px]:grid-cols-3">
        <Stat label="End-to-end" value={fmtMs(trace.durationMs)} />
        <Stat label="First status" value={fmtMs(trace.firstStatusMs)} hint="Time until the first step indicator was shown" />
        <Stat label="Answer ready" value={fmtMs(trace.answerReadyMs)} hint="Time until the validated answer was released" />
        <Stat label="LLM / tools" value={`${t.llmCalls} / ${t.toolCalls}`} />
        <Stat label="Tokens in/out" value={`${fmtTokens(t.inputTokens)} / ${fmtTokens(t.outputTokens)}`} />
        <Stat label="Est. cost" value={fmtUsd(t.costUsd)} />
      </div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="mt-2 flex items-center gap-1 text-xs font-medium text-muted hover:text-fg"
      >
        {open ? <ChevronDown aria-hidden className="size-3.5" /> : <ChevronRight aria-hidden className="size-3.5" />}
        Span waterfall · {trace.spans.length} span{trace.spans.length === 1 ? '' : 's'}
        {guardrails.length ? ` · ${guardrails.length} guardrail event${guardrails.length === 1 ? '' : 's'}` : ''}
      </button>
      {open ? (
        <div className="mt-2 space-y-3">
          <Waterfall trace={trace} />
          {guardrails.length ? (
            <div>
              <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Guardrails</h4>
              <ul className="space-y-1.5">
                {guardrails.map((g, i) => (
                  <li key={i} className="flex flex-col gap-0.5">
                    <span>
                      <GuardrailChip g={g} />
                    </span>
                    <span className="pl-1 text-[11.5px] text-muted">{g.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="font-mono text-[10.5px] text-faint">{trace.turnId}</p>
        </div>
      ) : null}
    </article>
  );
}

export function TurnsTab({ traces, guardrailsByTurn }: { traces: TurnTrace[]; guardrailsByTurn: Map<string, GuardrailEvent[]> }) {
  // The newest agent turn is expanded automatically; anything the user toggles keeps its state.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  if (!traces.length)
    return (
      <div className="px-2 py-10 text-center">
        <p className="text-sm font-medium text-fg-2">No turns yet</p>
        <p className="mt-1 text-xs text-muted">Send a message and its full trace (spans, prompts, tool calls, cost) shows up here live.</p>
      </div>
    );
  const newestFirst = [...traces].reverse();
  const newestAgent = newestFirst.find((t) => t.outcome !== 'voice_usage')?.turnId;
  return (
    <div className="space-y-2.5">
      {newestFirst.map((t) => {
        const open = toggled[t.turnId] ?? t.turnId === newestAgent;
        return (
          <TurnCard
            key={t.turnId}
            trace={t}
            guardrails={guardrailsByTurn.get(t.turnId) ?? (t.guardrails ?? []).map((g) => ({ ...g, type: 'guardrail' as const, turnId: t.turnId, check: g.check as GuardrailEvent['check'] }))}
            open={open}
            onToggle={() => setToggled((m) => ({ ...m, [t.turnId]: !open }))}
          />
        );
      })}
    </div>
  );
}
