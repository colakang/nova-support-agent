-- Postgres 16+ with pgvector. One database for vectors, full-text, sessions and traces.
create extension if not exists vector;

create table if not exists chunks (
  id             text primary key,          -- "<doc_id>#<n>"
  doc_id         text not null,
  title          text not null,
  section_path   text not null,             -- "Pro plans > Annual billing"
  doc_type       text not null,
  tiers          text[] not null,           -- {'all'} or subset of starter/pro/enterprise
  kind           text not null,             -- prose | table_row
  content        text not null,             -- breadcrumb + text (what gets embedded)
  token_count    int  not null,
  embedding      vector(1536) not null,
  tsv            tsvector generated always as (to_tsvector('english', content)) stored,
  corpus_version text not null
);
create index if not exists chunks_embedding_idx on chunks using hnsw (embedding vector_cosine_ops);
create index if not exists chunks_tsv_idx on chunks using gin (tsv);

create table if not exists sessions (
  id          text primary key,
  state       text not null default 'active',
  facts       jsonb not null,
  chaos       jsonb not null default '{}'::jsonb,
  client_ip   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists messages (
  id          text primary key,
  session_id  text not null references sessions(id) on delete cascade,
  turn_id     text,
  role        text not null,
  mode        text not null,
  content     text not null,
  kind        text,
  citations   jsonb,
  interrupted boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists messages_session_idx on messages (session_id, created_at);

create table if not exists traces (
  turn_id     text primary key,
  session_id  text not null references sessions(id) on delete cascade,
  mode        text not null,
  data        jsonb not null,
  cost_usd    numeric(12,6) not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists traces_session_idx on traces (session_id, created_at);

-- Idempotency for the only irreversible mock action: one refund per (session, invoice), ever.
create table if not exists refunds (
  idempotency_key text primary key,
  session_id      text not null,
  customer_id     text not null,
  invoice_id      text not null,
  amount          numeric(12,2) not null,
  refund_id       text not null,
  created_at      timestamptz not null default now()
);

-- Daily spend ledger (all LLM + realtime cost estimates) for the hard budget cap.
create table if not exists spend (
  day  date primary key,
  usd  numeric(12,6) not null default 0
);
