# syntax=docker/dockerfile:1

# Express + ffmpeg video watermarker. ffmpeg is required at runtime (large);
# keep Debian slim, avoid recommends, run as non-root with writable dirs.

FROM node:26.13.0-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9

WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm@10.33.0 && pnpm install --frozen-lockfile --prod && (pnpm store prune || true)

COPY index.mjs Wanderstories-logo.png favicon.ico ./

RUN mkdir -p temp videos \
  && chown -R node:node /app/temp /app/videos

USER node

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||8090)+'/', (r) => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"

CMD ["node", "index.mjs"]
