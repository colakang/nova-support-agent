# API image. No compile step: TypeScript runs through tsx, so the image builds in seconds on a
# small ARM or x86 box. Build context = repo root.
FROM node:22-alpine AS deps
WORKDIR /app
RUN npm install -g pnpm@12.6.0
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/rag/package.json packages/rag/
COPY packages/tools/package.json packages/tools/
COPY packages/agent/package.json packages/agent/
RUN pnpm install --frozen-lockfile --prod --filter "@sa/api..."

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/app/data PORT=8080
COPY --from=deps /app /app
COPY packages packages
COPY apps/api apps/api
COPY data data
COPY db db
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
WORKDIR /app/apps/api
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1
CMD ["node", "--import", "tsx", "src/index.ts"]
