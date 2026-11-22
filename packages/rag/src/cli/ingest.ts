// pnpm ingest [--force] [--dry]   — chunk data/corpus, embed, upsert into pgvector.
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { loadEnv } from '@sa/shared/env';
import { openaiEmbedder } from '../embed';
import { ingest, loadCorpus } from '../ingest';

loadEnv();
const dir = fileURLToPath(new URL('../../../../data/corpus', import.meta.url));
const args = new Set(process.argv.slice(2));

if (args.has('--dry')) {
  const { files, chunks, version } = loadCorpus(dir);
  const byKind = chunks.reduce<Record<string, number>>((a, c) => ((a[c.kind] = (a[c.kind] ?? 0) + 1), a), {});
  const sizes = chunks.map((c) => c.tokenCount).sort((a, b) => a - b);
  console.log({ version, docs: files.length, chunks: chunks.length, byKind, tokens: { min: sizes[0], p50: sizes[Math.floor(sizes.length / 2)], max: sizes.at(-1) } });
  for (const c of chunks.slice(0, Number(process.env.SHOW ?? 0))) console.log('---', c.id, c.tiers, '\n' + c.content);
  process.exit(0);
}

const sql = postgres(process.env.DATABASE_URL!, { max: 2, onnotice: () => {} });
const r = await ingest(sql, openaiEmbedder(), dir, { force: args.has('--force') });
console.log(r);
await sql.end();
