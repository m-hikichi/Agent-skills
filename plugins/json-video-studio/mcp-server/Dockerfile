# Build context is the plugin root (schemas/ and examples/ are bundled).
FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY mcp-server/package.json mcp-server/package-lock.json ./
RUN npm ci

COPY mcp-server/ ./
COPY schemas/ /schemas/

RUN npm run build

FROM build AS production-dependencies

RUN npm ci --omit=dev

FROM node:24-bookworm-slim AS runtime-base

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    JSON_VIDEO_SCHEMA_PATH=/app/schemas/video-project.schema.json \
    JSON_VIDEO_WORKSPACE_ROOT=/workspace \
    JSON_VIDEO_DATA_ROOT=/data \
    JSON_VIDEO_UI_HOST=0.0.0.0 \
    JSON_VIDEO_ALLOW_CONTAINER_BIND=1 \
    JSON_VIDEO_UI_PORT=43120 \
    JSON_VIDEO_VOICEVOX_URL=http://voicevox:50021 \
    CHROME_BIN=/usr/bin/chromium

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        chromium \
        ffmpeg \
        fontconfig \
        fonts-noto-cjk \
        fonts-noto-mono \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --chown=node:node schemas ./schemas
COPY --chown=node:node examples ./examples

FROM runtime-base AS test

ENV NODE_ENV=test

COPY --from=build --chown=node:node /app ./
COPY --chown=node:node schemas /schemas
COPY --chown=node:node examples /examples
RUN mkdir -p /app/test-results && chown -R node:node /app/test-results

USER node
ENTRYPOINT ["npm"]
CMD ["run", "test:e2e"]

FROM runtime-base AS runtime

COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json

RUN mkdir -p /workspace /data && chown -R node:node /workspace /data

USER node
EXPOSE 43120
ENTRYPOINT ["node", "/app/dist/cli/index.js"]
CMD ["--help"]
