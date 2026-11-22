import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Sql } from 'postgres';
import { type Chunk, chunkDocument } from './chunker';
import { type Embedder, toPgVector } from './embed';

export function loadCorpus(dir: string): { files: string[]; chunks: Chunk[]; version: string } {
  const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  const hash = createHash('sha256');
  const chunks: Chunk[] = [];
  for (const f of files) {
    const md = readFileSync(join(dir, f), 'utf8');
    hash.update(f).update(md);
    chunks.push(...chunkDocument(md));
  }
  return { files, chunks, version: hash.digest('hex').slice(0, 12) };
}

/** Idempotent: skips embedding entirely if this corpus version is already indexed. */
export async function ingest(sql: Sql, embedder: Embedder, dir: string, opts: { force?: boolean } = {}) {
  const { files, chunks, version } = loadCorpus(dir);
  const [existing] = await sql<{ n: number }[]>`select count(*)::int as n from chunks where corpus_version = ${version}`;
  if (!opts.force && existing && existing.n === chunks.length && chunks.length > 0) {
    return { version, docs: files.length, chunks: chunks.length, embedded: 0, tokens: 0, skipped: true };
  }
  const { vectors, tokens } = await embedder.embed(chunks.map((c) => c.content));
  await sql.begin(async (tx) => {
    await tx`delete from chunks`;
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i]!;
      await tx`
        insert into chunks (id, doc_id, title, section_path, doc_type, tiers, kind, content, token_count, embedding, corpus_version)
        values (${c.id}, ${c.docId}, ${c.title}, ${c.sectionPath}, ${c.docType}, ${c.tiers}, ${c.kind}, ${c.content},
                ${c.tokenCount}, ${toPgVector(vectors[i]!)}::vector, ${version})`;
    }
  });
  return { version, docs: files.length, chunks: chunks.length, embedded: chunks.length, tokens, skipped: false };
}
