// Answer guardrails, run on every `respond` BEFORE anything reaches the customer.
// In voice you can't un-say a sentence, so both modes release only validated answers.
//
//   1. citation_integrity   grounded answers must cite chunks retrieved this turn
//   2. retrieval_confidence cited chunks must clear τ_low; between τ_low and τ_high → judge
//   3. grounding_judge      small model checks every claim is supported by the cited text
//   4. number_provenance    every $ / % / "N days" in the answer must appear in a source
//   5. tool_policy          can't claim a refund that the billing tool didn't commit
//   6. escalation_policy    if a tool or rule said "human", a ticket must exist
import type { AnswerKind, Citation, SessionFacts } from '@sa/shared';
import type { RetrievedChunk, Thresholds } from '@sa/rag';
import type { TurnState } from '@sa/tools';

export interface RespondArgs {
  answer: string;
  kind: AnswerKind;
  citations: string[];
  customer_sentiment: 'positive' | 'neutral' | 'frustrated' | 'angry';
}

export interface Violation { check: 'citation_integrity' | 'retrieval_confidence' | 'number_provenance' | 'tool_policy' | 'escalation_policy' | 'grounding_judge'; detail: string }

export interface ValidationResult {
  violations: Violation[];
  /** Cited chunks whose best similarity is in the medium band → needs the judge. */
  needsJudge: boolean;
  citedChunks: RetrievedChunk[];
  numbersChecked: string[];
}

/** Every number the answer states must be traceable. Identifiers (INV-1042, E-4410, RF-…, T-…) and
 *  email addresses are stripped first; everything else — prices, limits, days, percentages — is checked. */
export function numericClaims(text: string): string[] {
  const t = text
    .replace(/\S+@\S+/g, ' ')
    .replace(/\b[A-Z]{1,4}-[A-Z0-9-]+\b/g, ' ');
  return [...new Set([...t.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => norm(m[0].replace(/,$/, ''))))];
}

function norm(n: string): string {
  const v = Number(n.replace(/,/g, ''));
  return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : n;
}

/** All numbers present in a body of source text, normalised the same way. */
export function numbersIn(text: string): Set<string> {
  const s = new Set<string>();
  for (const m of text.replace(/\b(\d+),(\d{3})\b/g, '$1$2').matchAll(/\d+(?:\.\d+)?/g)) s.add(norm(m[0]));
  return s;
}

const REFUND_CLAIM = /\b(i'?ve|i have|we'?ve|we have|has been|have been|was|is)\s+(been\s+)?(refunded|issued (a|your|the) refund|processed (a|your|the) refund)|\brefund (has been|was|is) (issued|processed|on its way)/i;

export function validateRespond(
  r: RespondArgs,
  turn: TurnState,
  facts: SessionFacts,
  thresholds: Thresholds,
  sourcesText: string,
  required: { ticket: string | null },
): ValidationResult {
  const v: Violation[] = [];
  const cited = r.citations.map((id) => turn.chunks.get(id)).filter((c): c is RetrievedChunk => !!c);

  // 1. citation integrity
  const unknown = r.citations.filter((id) => !turn.chunks.has(id));
  if (unknown.length) v.push({ check: 'citation_integrity', detail: `Cited ids not retrieved this turn: ${unknown.join(', ')}. Cite only chunk_ids from this turn's search results.` });
  if (r.kind === 'grounded' && cited.length === 0) v.push({ check: 'citation_integrity', detail: 'kind is grounded but no valid citations. Search first, then cite the chunk_ids you used.' });

  // 2. retrieval confidence of what was actually cited
  const best = cited.reduce((m, c) => Math.max(m, c.similarity), 0);
  if (r.kind === 'grounded' && cited.length && best < thresholds.low) {
    v.push({ check: 'retrieval_confidence', detail: `Cited passages are below the confidence threshold (${best.toFixed(2)} < ${thresholds.low}). Don't answer from them; offer a specialist.` });
  }
  const needsJudge = r.kind === 'grounded' && cited.length > 0 && best >= thresholds.low && best < thresholds.high;

  // 3. number provenance
  const claims = numericClaims(r.answer);
  if (claims.length) {
    const have = numbersIn(sourcesText);
    const missing = claims.filter((n) => !have.has(n));
    if (missing.length) v.push({ check: 'number_provenance', detail: `These numbers don't appear in any passage or tool result from this turn: ${missing.join(', ')}. Remove them or look them up.` });
  }

  // 4. can't claim money moved unless it did
  const refundedBefore = facts.refunds.length > 0;
  if (REFUND_CLAIM.test(r.answer) && !turn.refundCommitted && !refundedBefore) {
    v.push({ check: 'tool_policy', detail: 'The answer says a refund was issued, but no refund was committed by issue_refund.' });
  }

  // 5. escalation obligations
  const mustEscalate = required.ticket ?? (turn.requiresHuman.length ? turn.requiresHuman[0]! : null);
  if (mustEscalate && !turn.ticketCreated && !facts.tickets.length) {
    v.push({ check: 'escalation_policy', detail: `A human must handle this (${mustEscalate}). Call create_escalation_ticket, then respond with the ticket id and next steps.` });
  }
  return { violations: v, needsJudge, citedChunks: cited, numbersChecked: claims };
}

export const toCitation = (c: RetrievedChunk): Citation => ({ chunkId: c.id, docId: c.docId, title: c.title, section: c.sectionPath, score: Number(c.similarity.toFixed(3)) });

export const JUDGE_SCHEMA = {
  name: 'grounding_verdict',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['supported', 'unsupported_claims'],
    properties: { supported: { type: 'boolean' }, unsupported_claims: { type: 'array', items: { type: 'string' } } },
  },
};

export const JUDGE_INSTRUCTIONS = `You verify a customer-support answer against source passages.
Return supported=true only if every factual claim in the ANSWER is stated or directly implied by the PASSAGES or TOOL RESULTS.
Greetings, offers to help, and questions back to the customer are not claims. List each unsupported claim briefly.`;
