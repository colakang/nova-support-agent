// Structure-aware chunker for support policy markdown.
//
// Why not fixed-size windows: policy clauses carry their conditions in the same paragraph
// ("Pro monthly charges can be refunded within 30 days"). A 512-token window that splits
// "within 30 days" from "Pro monthly" retrieves half a truth. So:
//   1. A chunk never crosses an H2/H3 boundary; every chunk is prefixed with its breadcrumb
//      (Doc title > Section > Subsection) so the embedding knows which plan/topic it is about.
//   2. Markdown tables are split by row, and each row is rendered with its header
//      ("Plan: Pro | API requests/min: 600") so one row is a self-contained fact.
//   3. Long sections are split on paragraph boundaries (target ~350 tokens) with a one-paragraph
//      overlap; short sections stay whole.
//   4. Tier applicability comes from frontmatter and can be narrowed per section with
//      `<!-- tiers: pro, enterprise -->` right under a heading. Subsections inherit.

export interface DocMeta {
  id: string;
  title: string;
  doc_type: string;
  tiers: string[];
  effective_date?: string;
}

export interface Chunk {
  id: string;
  docId: string;
  title: string;
  sectionPath: string;
  docType: string;
  tiers: string[];
  kind: 'prose' | 'table_row';
  /** Breadcrumb + body. This exact string is embedded and shown to the model. */
  content: string;
  tokenCount: number;
}

export const CHUNK_TARGET_TOKENS = 350;
export const CHUNK_MAX_TOKENS = 450;

export const estimateTokens = (s: string) => Math.ceil(s.length / 4);

export function parseFrontmatter(md: string): { meta: DocMeta; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(md);
  if (!m) throw new Error('missing frontmatter');
  const meta: Record<string, unknown> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([a-z_]+):\s*(.*?)\s*(#.*)?$/.exec(line.trim());
    if (!kv) continue;
    const raw = kv[2]!;
    meta[kv[1]!] = raw.startsWith('[')
      ? raw.slice(1, -1).split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
      : raw.replace(/^['"]|['"]$/g, '');
  }
  for (const k of ['id', 'title', 'doc_type'] as const) if (typeof meta[k] !== 'string') throw new Error(`frontmatter.${k} missing`);
  const tiers = Array.isArray(meta.tiers) && meta.tiers.length ? (meta.tiers as string[]) : ['all'];
  return { meta: { ...(meta as unknown as DocMeta), tiers }, body: m[2]! };
}

const TIER_COMMENT = /^<!--\s*tiers:\s*([a-z,\s]+)-->\s*$/i;
const HEADING = /^(#{1,6})\s+(.*)$/;

interface Section { path: string[]; tiers: string[]; lines: string[] }

function sections(meta: DocMeta, body: string): Section[] {
  const out: Section[] = [];
  let h2: { title: string; tiers: string[] } | null = null;
  let cur: Section = { path: [], tiers: meta.tiers, lines: [] };
  const flush = () => { if (cur.lines.some((l) => l.trim())) out.push(cur); };
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const h = HEADING.exec(line);
    if (h && h[1]!.length >= 1 && h[1]!.length <= 3) {
      const level = h[1]!.length;
      if (level === 1) continue; // doc title, already in breadcrumb
      flush();
      const next = lines[i + 1]?.trim() ?? '';
      const tc = TIER_COMMENT.exec(next);
      const ownTiers = tc ? tc[1]!.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : null;
      if (tc) i++;
      if (level === 2) {
        h2 = { title: h[2]!.trim(), tiers: ownTiers ?? meta.tiers };
        cur = { path: [h2.title], tiers: h2.tiers, lines: [] };
      } else {
        const parentTiers = h2?.tiers ?? meta.tiers;
        cur = { path: [...(h2 ? [h2.title] : []), h[2]!.trim()], tiers: ownTiers ?? parentTiers, lines: [] };
      }
      continue;
    }
    if (TIER_COMMENT.test(line.trim())) continue;
    cur.lines.push(line);
  }
  flush();
  return out;
}

type Block = { kind: 'prose'; text: string } | { kind: 'table'; header: string[]; rows: string[][] };

const cells = (row: string) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const isSeparator = (row: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(row);

function blocks(lines: string[]): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  const flushPara = () => {
    const t = para.join('\n').trim();
    if (t) out.push({ kind: 'prose', text: t });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim().startsWith('|') && isSeparator(lines[i + 1] ?? '')) {
      flushPara();
      const header = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.trim().startsWith('|')) rows.push(cells(lines[i++]!));
      i--;
      out.push({ kind: 'table', header, rows });
      continue;
    }
    if (!line.trim()) { flushPara(); continue; }
    para.push(line);
  }
  flushPara();
  return out;
}

export function chunkDocument(md: string): Chunk[] {
  const { meta, body } = parseFrontmatter(md);
  const chunks: Chunk[] = [];
  const push = (sec: Section, kind: Chunk['kind'], text: string) => {
    const sectionPath = sec.path.join(' > ') || 'Overview';
    const content = `${meta.title} > ${sectionPath}\n\n${text}`;
    chunks.push({
      id: `${meta.id}#${chunks.length}`,
      docId: meta.id,
      title: meta.title,
      sectionPath,
      docType: meta.doc_type,
      tiers: sec.tiers,
      kind,
      content,
      tokenCount: estimateTokens(content),
    });
  };

  for (const sec of sections(meta, body)) {
    let buf: string[] = [];
    let bufTokens = 0;
    const flush = (keepLast: boolean) => {
      if (!buf.length) return;
      push(sec, 'prose', buf.join('\n\n'));
      const last = buf[buf.length - 1]!;
      buf = keepLast && estimateTokens(last) < CHUNK_TARGET_TOKENS / 2 ? [last] : [];
      bufTokens = buf.reduce((a, b) => a + estimateTokens(b), 0);
    };
    for (const b of blocks(sec.lines)) {
      if (b.kind === 'table') {
        flush(false);
        for (const row of b.rows) {
          const text = b.header.map((h, i) => `${h}: ${row[i] ?? ''}`).join(' | ');
          push(sec, 'table_row', text);
        }
        continue;
      }
      const t = estimateTokens(b.text);
      if (bufTokens + t > CHUNK_MAX_TOKENS && buf.length) flush(true);
      buf.push(b.text);
      bufTokens += t;
      if (bufTokens >= CHUNK_TARGET_TOKENS) flush(true);
    }
    flush(false);
  }
  return chunks;
}
