import { serve } from '@hono/node-server';
import postgres from 'postgres';
import { defaultConfig } from '@sa/agent';
import { openaiEmbedder, pgRetriever } from '@sa/rag';
import { loadEnv } from '@sa/shared/env';
import { loadCustomers, pgRefundLedger } from '@sa/tools';
import { loadConfig } from './config';
import { pgBudget, pgStore } from './db';
import { buildApp } from './server';

loadEnv();
const cfg = loadConfig();
const sql = postgres(cfg.databaseUrl, { max: 10, idle_timeout: 30, onnotice: () => {} });
const store = pgStore(sql);
const budget = pgBudget(sql, cfg.dailyBudgetUsd, cfg.sessionBudgetUsd);
const agentConfig = defaultConfig();

const app = buildApp({
  cfg, sql, store, budget,
  agent: {
    retriever: pgRetriever(sql, openaiEmbedder(), cfg.thresholds),
    customers: loadCustomers(),
    ledger: pgRefundLedger(sql),
    store,
    budget,
    config: agentConfig,
  },
});

const server = serve({ fetch: app.fetch, port: cfg.port }, (info) => {
  console.log(`[api] listening on :${info.port} · agent=${agentConfig.agentModel} (${agentConfig.serviceTier}) fallback=${agentConfig.fallbackModel} τ=${cfg.thresholds.low}/${cfg.thresholds.high} budget=$${cfg.dailyBudgetUsd}/day`);
});

const shutdown = async () => {
  server.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
