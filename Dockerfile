# syntax=docker/dockerfile:1

# Express + ffmpeg video watermarker. ffmpeg is required at runtime (large);
# keep Debian slim, avoid recommends, run as non-root with writable dirs.

FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205

WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate && pnpm install --frozen-lockfile --prod && (pnpm store prune || true)

COPY index.mjs Wanderstories-logo.png favicon.ico ./

RUN mkdir -p temp videos \
  && chown -R node:node /app/temp /app/videos

USER node

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||8090)+'/', (r) => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"

CMD ["node", "index.mjs"]
