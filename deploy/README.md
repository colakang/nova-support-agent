# Deploy

The production target is a single small host (2 GB ARM EC2) shared with other services.

```
Cloudflare (proxied DNS, TLS) → host nginx (origin cert) ─┬─ /        static web build (/var/www/support-demo)
                                                          └─ /api/    127.0.0.1:8095 → api container → db container (pgvector)
```

## Steps

1. **Host prerequisites:** Docker with Compose v2, a reverse proxy (nginx example provided; Caddy works too) and TLS for the domain. A secure origin is mandatory: browsers only allow the microphone over HTTPS. Local machine: Node 22+ and pnpm 12+ to build the static web.
2. **nginx site:** copy `deploy/nginx.conf.example` to `/etc/nginx/sites-available/<name>`, replace `SITE_DOMAIN`, symlink it into `sites-enabled`, then run `sudo nginx -t && sudo systemctl reload nginx`.
3. **Environment:** on the host, create `~/support-agent/.env` with `chmod 600`, starting from `.env.example`. Secrets never leave the host.

   | variable | production value |
   |---|---|
   | `OPENAI_API_KEY` | a dedicated project key with a monthly limit (**required**) |
   | `POSTGRES_PASSWORD` | random, e.g. `openssl rand -hex 16` (**required**) |
   | `API_PORT` | host port the reverse proxy targets (default `8095`) |
   | `DAILY_BUDGET_USD` / `SESSION_BUDGET_USD` | `1.5` / `0.4` on the live demo |
   | `RATE_LIMIT_*`, `VOICE_MAX_SESSION_SECONDS` | see `.env.example` |
   | models, `RETRIEVAL_TAU_*` | defaults are what the live demo runs |

   `DATABASE_URL`, `PORT`, `DATA_DIR` and `TRUST_PROXY=1` are set by `docker-compose.yml`. `CORS_ORIGINS` is not needed because the web and API share one origin.
4. **Deploy:** from your machine, run `DEPLOY_HOST=<ssh alias> SITE_DOMAIN=<domain> ./deploy/deploy.sh`. The script:
   - builds the static web export;
   - rsyncs the source to the host (no `.env`, no `node_modules`);
   - builds the API image on the host (there's no compile step, so it's fine on ARM);
   - runs the migration and ingestion inside the container;
   - checks `https://<domain>/api/health`.

## Notes

- **Memory:** both containers have memory limits (db 256 MB, api 320 MB). Measured idle use is about 40 MB for the API and about 70 MB for Postgres.
- **Ports:** containers bind to 127.0.0.1 only and run on their own bridge network.
- **Streaming:** for SSE through nginx, the API sends `X-Accel-Buffering: no` and the site sets `proxy_buffering off`. Cloudflare passes `text/event-stream` through unbuffered.
- **Rate limiting:** client IPs come from `CF-Connecting-IP` (`TRUST_PROXY=1`). A production setup would also restrict the origin to Cloudflare IP ranges.
