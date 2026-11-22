// Hybrid retrieval: pgvector cosine + Postgres full-text, fused with Reciprocal Rank Fusion.
// Vector search handles paraphrase ("get my money back" ~ "refund"); full-text catches exact
// tokens embeddings blur (error codes like E-4410, plan names, numbers).
//
// Tier handling: we search the whole corpus once, then PARTITION in code into
//   - eligible: chunks that apply to the customer's tier (or 'all')
//   - otherTier: strong matches that only apply to other tiers
// so the agent can say "SSO is an Enterprise feature" instead of "I don't know".
//
// Confidence = best cosine similarity among eligible chunks (RRF scores are rank-based and not
// comparable across queries, so they are only used for ordering). Thresholds are calibrated
// on a labelled query set — see evals/calibrate.ts.
import type { Sql } from 'postgres';
import type { Tier } from '@sa/shared';
import { type Embedder, toPgVector } from './embed';

export interface RetrievedChunk {
  id: string;
  docId: string;
  title: string;
  sectionPath: string;
  tiers: string[];
  kind: string;
  content: string;
  similarity: number;
  rrf: number;
}

export type ConfidenceBand = 'high' | 'medium' | 'low';

export interface Thresholds { high: number; low: number }

export interface RetrievalResult {
  query: string;
  tier: Tier | null;
  chunks: RetrievedChunk[];
  otherTier: RetrievedChunk[];
  topSimilarity: number;
  band: ConfidenceBand;
  thresholds: Thresholds;
  embedTokens: number;
  embedModel: string;
  timings: { embedMs: number; searchMs: number };
}

export interface Retriever {
  search(query: string, opts: { tier: Tier | null; k?: number; signal?: AbortSignal }): Promise<RetrievalResult>;
  readonly thresholds: Thresholds;
}

export class RetrievalUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = 'RetrievalUnavailableError'; }
}

const RRF_K = 60;
const STOP = new Set('a an and are as at be but by can could do does for from had has have how i if in into is it its me my of on or our please should so than that the their them then there these this to too us was we were what when where which who why will with would you your'.split(' '));

/** OR-query over meaningful terms (websearch_to_tsquery would AND every word of a question). */
export function keywordQuery(q: string): string | null {
  const terms = [...new Set(q.toLowerCase().match(/[a-z0-9]+/g) ?? [])].filter((t) => t.length > 1 && !STOP.has(t));
  return terms.length ? terms.slice(0, 16).join(' | ') : null;
}

export const bandFor = (sim: number, t: Thresholds): ConfidenceBand => (sim >= t.high ? 'high' : sim >= t.low ? 'medium' : 'low');

export const eligibleFor = (tiers: string[], tier: Tier | null) => tier === null || tiers.includes('all') || tiers.includes(tier);

export function pgRetriever(sql: Sql, embedder: Embedder, thresholds: Thresholds): Retriever {
  return {
    thresholds,
    async search(query, { tier, k = 5, signal }) {
      const t0 = performance.now();
      let vec: number[];
      let embedTokens = 0;
      try {
        const r = await embedder.embed([query], signal);
        vec = r.vectors[0]!;
        embedTokens = r.tokens;
      } catch (err) {
        throw new RetrievalUnavailableError(`embedding failed: ${(err as Error).message}`);
      }
      const t1 = performance.now();
      const kw = keywordQuery(query);
      let rows: Array<{ id: string; doc_id: string; title: string; section_path: string; tiers: string[]; kind: string; content: string; similarity: number; rrf: number }>;
      try {
        rows = await sql`
          with q as (select ${toPgVector(vec)}::vector as v, to_tsquery('english', ${kw ?? 'zzzznomatch'}) as tq),
          vec as (
            select id, row_number() over (order by embedding <=> (select v from q)) as r
            from chunks order by embedding <=> (select v from q) limit 30
          ),
          fts as (
            select id, row_number() over (order by ts_rank_cd(tsv, (select tq from q)) desc) as r
            from chunks where tsv @@ (select tq from q)
            order by ts_rank_cd(tsv, (select tq from q)) desc limit 30
          ),
          ids as (select id from vec union select id from fts)
          select c.id, c.doc_id, c.title, c.section_path, c.tiers, c.kind, c.content,
                 (1 - (c.embedding <=> (select v from q)))::float8 as similarity,
                 (coalesce(1.0 / (${RRF_K} + vec.r), 0) + coalesce(1.0 / (${RRF_K} + fts.r), 0))::float8 as rrf
          from ids
          join chunks c on c.id = ids.id
          left join vec on vec.id = ids.id
          left join fts on fts.id = ids.id
          order by rrf desc
          limit 40`;
      } catch (err) {
        throw new RetrievalUnavailableError(`vector store query failed: ${(err as Error).message}`);
      }
      const t2 = performance.now();
      const all: RetrievedChunk[] = rows.map((r) => ({
        id: r.id, docId: r.doc_id, title: r.title, sectionPath: r.section_path, tiers: r.tiers,
        kind: r.kind, content: r.content, similarity: Number(r.similarity), rrf: Number(r.rrf),
      }));
      const eligible = all.filter((c) => eligibleFor(c.tiers, tier));
      const others = all.filter((c) => !eligibleFor(c.tiers, tier));
      const topSimilarity = eligible.reduce((m, c) => Math.max(m, c.similarity), 0);
      const floor = thresholds.low - 0.05;
      return {
        query,
        tier,
        chunks: eligible.filter((c) => c.similarity >= floor).slice(0, k),
        otherTier: others.filter((c) => c.similarity >= thresholds.high).slice(0, 2),
        topSimilarity,
        band: bandFor(topSimilarity, thresholds),
        thresholds,
        embedTokens,
        embedModel: embedder.model,
        timings: { embedMs: Math.round(t1 - t0), searchMs: Math.round(t2 - t1) },
      };
    },
  };
}
