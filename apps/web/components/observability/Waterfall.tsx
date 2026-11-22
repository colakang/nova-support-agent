'use client';
// Span waterfall for one turn: bars positioned by startMs / durationMs, coloured by span kind.
// Clicking a span opens its attrs (prompts, tool args/results, retrieval candidates).
import { useState } from 'react';
import type { Span, SpanKind, TurnTrace } from '@sa/shared';
import { fmtMs, fmtTokens, fmtUsd } from '@/lib/format';
import { Badge, cx } from '@/components/ui/primitives';
import { JsonBlock } from './bits';

export const KIND_COLOR: Record<SpanKind, string> = {
  llm: 'bg-k-llm',
  tool: 'bg-k-tool',
  retrieval: 'bg-k-retrieval',
  guardrail: 'bg-k-guardrail',
  embed: 'bg-k-embed',
  turn: 'bg-k-turn',
};

const LEGEND: SpanKind[] = ['llm', 'tool', 'retrieval', 'guardrail'];

function depthOf(span: Span, byId: Map<string, Span>): number {
  let d = 0;
  let p = span.parentId ? byId.get(span.parentId) : undefined;
  while (p && d < 6) {
    d++;
    p = p.parentId ? byId.get(p.parentId) : undefined;
  }
  return d;
}

function SpanDetail({ span }: { span: Span }) {
  return (
    <div className="animate-fade-in mt-2 rounded-lg border border-line bg-surface p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cx('size-2 rounded-sm', KIND_COLOR[span.kind])} />
        <span className="font-mono text-[12px] font-semibold text-fg">{span.name}</span>
        <Badge>{span.kind}</Badge>
        <Badge tone={span.status === 'ok' ? 'ok' : span.status === 'error' ? 'bad' : 'warn'}>{span.status}</Badge>
        {span.attempt && span.attempt > 1 ? <Badge tone="warn">attempt {span.attempt}</Badge> : null}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11.5px] sm:grid-cols-3">
        <div>
          <dt className="text-faint">start</dt>
          <dd className="font-mono tabular-nums text-fg-2">+{fmtMs(span.startMs)}</dd>
        </div>
        <div>
          <dt className="text-faint">duration</dt>
          <dd className="font-mono tabular-nums text-fg-2">{fmtMs(span.durationMs)}</dd>
        </div>
        {span.model ? (
          <div>
            <dt className="text-faint">model</dt>
            <dd className="truncate font-mono text-fg-2" title={span.model}>
              {span.model}
            </dd>
          </div>
        ) : null}
        {span.usage ? (
          <div>
            <dt className="text-faint">tokens in / cached / out</dt>
            <dd className="font-mono tabular-nums text-fg-2">
              {fmtTokens(span.usage.inputTokens)} / {fmtTokens(span.usage.cachedInputTokens)} / {fmtTokens(span.usage.outputTokens)}
            </dd>
          </div>
        ) : null}
        {span.costUsd !== undefined ? (
          <div>
            <dt className="text-faint">est. cost</dt>
            <dd className="font-mono tabular-nums text-fg-2">{fmtUsd(span.costUsd)}</dd>
          </div>
        ) : null}
      </dl>
      <div className="mt-2">
        {span.attrs && Object.keys(span.attrs).length ? <JsonBlock value={span.attrs} label={`${span.name} attributes`} /> : <p className="text-xs text-faint">No attributes recorded.</p>}
      </div>
    </div>
  );
}

export function Waterfall({ trace }: { trace: TurnTrace }) {
  const [selected, setSelected] = useState<string | null>(null);
  const spans = [...trace.spans].sort((a, b) => a.startMs - b.startMs || b.durationMs - a.durationMs);
  const byId = new Map(spans.map((s) => [s.id, s] as const));
  const total = Math.max(1, trace.durationMs, ...spans.map((s) => s.startMs + s.durationMs));
  const sel = selected ? byId.get(selected) : undefined;

  if (!spans.length) return <p className="text-xs text-faint">No spans recorded for this turn.</p>;

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-3 text-[10.5px] text-muted">
        {LEGEND.map((k) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className={cx('size-2 rounded-sm', KIND_COLOR[k])} />
            {k}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-[minmax(0,36%)_1fr] gap-x-2">
        <div />
        <div className="relative mb-1 h-3.5 font-mono text-[9.5px] tabular-nums text-faint" aria-hidden>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <span key={f} className="absolute top-0 whitespace-nowrap" style={{ left: `${f * 100}%`, transform: f === 0 ? 'none' : f === 1 ? 'translateX(-100%)' : 'translateX(-50%)' }}>
              {fmtMs(total * f)}
            </span>
          ))}
        </div>
      </div>
      <ul className="space-y-px" aria-label="Spans">
        {spans.map((s) => {
          const left = (s.startMs / total) * 100;
          const width = Math.max((s.durationMs / total) * 100, 0.6);
          const on = s.id === selected;
          const depth = depthOf(s, byId);
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setSelected(on ? null : s.id)}
                aria-pressed={on}
                aria-label={`${s.name}, ${s.kind}, starts at ${fmtMs(s.startMs)}, takes ${fmtMs(s.durationMs)}, ${s.status}`}
                className={cx('grid w-full grid-cols-[minmax(0,36%)_1fr] items-center gap-x-2 rounded px-0.5 py-0.5 text-left hover:bg-surface-2', on && 'bg-accent-soft hover:bg-accent-soft')}
              >
                <span className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: depth * 10 }}>
                  <span className={cx('size-1.5 shrink-0 rounded-full', KIND_COLOR[s.kind])} />
                  <span className={cx('truncate font-mono text-[11px]', s.status === 'error' ? 'text-bad-ink' : 'text-fg-2')}>{s.name}</span>
                </span>
                <span className="relative h-4 rounded-sm bg-surface-2">
                  <span
                    className={cx('absolute inset-y-0.5 rounded-sm', KIND_COLOR[s.kind], s.status === 'error' && 'ring-2 ring-bad', s.status === 'aborted' && 'opacity-50')}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  />
                  <span
                    className={cx(
                      'absolute top-1/2 -translate-y-1/2 whitespace-nowrap font-mono text-[9.5px] tabular-nums',
                      width > 22 ? 'font-semibold text-white' : 'text-muted',
                    )}
                    style={
                      width > 22
                        ? { right: `calc(${100 - left - width}% + 4px)` }
                        : left + width > 75
                          ? { right: `calc(${100 - left}% + 4px)` }
                          : { left: `calc(${left + width}% + 4px)` }
                    }
                  >
                    {fmtMs(s.durationMs)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {sel ? <SpanDetail span={sel} /> : <p className="mt-2 text-[11px] text-faint">Click a span to inspect its prompts, arguments and results.</p>}
    </div>
  );
}
