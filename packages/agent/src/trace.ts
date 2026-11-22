import { randomBytes } from 'node:crypto';
import type { Span, SpanKind, Usage } from '@sa/shared';

export const newId = (p: string) => `${p}_${randomBytes(6).toString('hex')}`;

/** Collects spans for one turn. Offsets are relative to the turn start so the drawer can draw a waterfall. */
export class TurnRecorder {
  readonly spans: Span[] = [];
  readonly t0 = performance.now();

  start(name: string, kind: SpanKind, parentId: string | null = null) {
    const id = newId('sp');
    const startMs = Math.round(performance.now() - this.t0);
    return {
      id,
      end: (p: { status?: Span['status']; model?: string; usage?: Usage; costUsd?: number; attempt?: number; attrs?: Record<string, unknown> } = {}) => {
        const span: Span = {
          id, parentId, name, kind, startMs,
          durationMs: Math.round(performance.now() - this.t0) - startMs,
          status: p.status ?? 'ok',
          ...(p.model ? { model: p.model } : {}),
          ...(p.usage ? { usage: p.usage } : {}),
          ...(p.costUsd !== undefined ? { costUsd: p.costUsd } : {}),
          ...(p.attempt !== undefined ? { attempt: p.attempt } : {}),
          ...(p.attrs ? { attrs: p.attrs } : {}),
        };
        this.spans.push(span);
        return span;
      },
    };
  }

  elapsed() { return Math.round(performance.now() - this.t0); }

  totals() {
    let inputTokens = 0, outputTokens = 0, costUsd = 0, llmCalls = 0, toolCalls = 0;
    for (const s of this.spans) {
      if (s.usage) { inputTokens += s.usage.inputTokens; outputTokens += s.usage.outputTokens; }
      costUsd += s.costUsd ?? 0;
      if (s.kind === 'llm') llmCalls++;
      if (s.kind === 'tool' || s.kind === 'retrieval') toolCalls++;
    }
    return { inputTokens, outputTokens, costUsd: Math.round(costUsd * 1e6) / 1e6, llmCalls, toolCalls };
  }
}
