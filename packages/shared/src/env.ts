// Tiny .env loader (no dependency). Looks in the repo root, then one level up (the author keeps
// real keys OUTSIDE the repo so they can never be committed). Never overrides real env vars.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export function findRepoRoot(start: string = process.cwd()): string {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return start;
}

const ALIASES: Record<string, string> = { openai_key: 'OPENAI_API_KEY' };

export function loadEnv(): void {
  const root = findRepoRoot(process.cwd());
  for (const file of [join(root, '.env'), resolve(root, '..', '.env')]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      const key = ALIASES[m[1]!] ?? m[1]!;
      const value = m[2]!.replace(/^['"]|['"]$/g, '');
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

export function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`missing env ${name}`);
  return v;
}

export function envNum(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== '' && process.env[name] !== undefined ? v : fallback;
}

/** Absolute path inside the repo's data/ directory (override with DATA_DIR, e.g. in Docker). */
export function dataPath(...parts: string[]): string {
  return join(process.env.DATA_DIR ?? join(findRepoRoot(), 'data'), ...parts);
}
