'use client';
import { ShieldAlert, ShieldCheck, ShieldX, ShieldEllipsis } from 'lucide-react';
import type { GuardrailEvent } from '@/lib/turnActivity';
import { humanize } from '@/lib/format';
import { Tooltip, cx, toneClasses, type Tone } from '@/components/ui/primitives';

const DECISION: Record<GuardrailEvent['decision'], { tone: Tone; Icon: typeof ShieldCheck; word: string }> = {
  pass: { tone: 'ok', Icon: ShieldCheck, word: 'passed' },
  warn: { tone: 'warn', Icon: ShieldEllipsis, word: 'warning' },
  fail: { tone: 'bad', Icon: ShieldX, word: 'failed' },
  escalate: { tone: 'esc', Icon: ShieldAlert, word: 'escalate' },
};

const CHECK_LABEL: Record<GuardrailEvent['check'], string> = {
  retrieval_confidence: 'Retrieval confidence',
  grounding_judge: 'Grounding judge',
  citation_integrity: 'Citations',
  number_provenance: 'Numbers',
  escalation_policy: 'Escalation policy',
  moderation: 'Content moderation',
  tool_policy: 'Tool policy',
  verification: 'Verification',
};

export function GuardrailChip({ g }: { g: GuardrailEvent }) {
  const d = DECISION[g.decision];
  const label = CHECK_LABEL[g.check] ?? humanize(g.check);
  const hasScore = g.score !== undefined;
  return (
    <Tooltip
      content={
        <span className="block">
          <span className="font-medium text-fg">
            {label} · {d.word}
          </span>
          {hasScore ? (
            <span className="block font-mono text-[10.5px] text-muted">
              score {g.score?.toFixed(3)}
              {g.threshold !== undefined ? ` · threshold ${g.threshold.toFixed(2)}` : ''}
            </span>
          ) : null}
          <span className="mt-0.5 block">{g.detail}</span>
        </span>
      }
    >
      <span
        tabIndex={0}
        className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4', toneClasses[d.tone])}
        aria-label={`Guardrail ${label} ${d.word}${hasScore ? `, score ${g.score?.toFixed(2)}` : ''}${g.threshold !== undefined ? `, threshold ${g.threshold.toFixed(2)}` : ''}. ${g.detail}`}
      >
        <d.Icon aria-hidden className="size-3" />
        {label}
        {hasScore ? (
          <span className="font-mono text-[10px] opacity-80">
            {g.score?.toFixed(2)}
            {g.threshold !== undefined ? (g.decision === 'fail' ? ' < ' : ' ≥ ') + g.threshold.toFixed(2) : ''}
          </span>
        ) : null}
      </span>
    </Tooltip>
  );
}

export function GuardrailChips({ guardrails }: { guardrails: GuardrailEvent[] }) {
  if (!guardrails.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Guardrail checks">
      {guardrails.map((g, i) => (
        <GuardrailChip key={`${g.check}-${i}`} g={g} />
      ))}
    </div>
  );
}
