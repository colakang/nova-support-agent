import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// Monorepo root, so Turbopack can resolve the workspace package @sa/shared (lives outside apps/web).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const nextConfig: NextConfig = {
  // Pure client SPA: `next build` writes static files to apps/web/out, served by nginx (which also proxies /api).
  output: 'export',
  transpilePackages: ['@sa/shared'],
  turbopack: { root: repoRoot },
  reactStrictMode: true,
  poweredByHeader: false,
  // Don't let `next dev` write AGENTS.md into the repo.
  agentRules: false,
};

export default nextConfig;
