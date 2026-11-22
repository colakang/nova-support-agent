// Applies db/schema.sql (idempotent). `pnpm db:migrate` locally, or inside the api container.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { findRepoRoot, loadEnv } from '@sa/shared/env';

loadEnv();
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const sql = postgres(url, { max: 1, onnotice: () => {} });
await sql.unsafe(readFileSync(join(findRepoRoot(), 'db', 'schema.sql'), 'utf8'));
console.log('schema applied');
await sql.end();
