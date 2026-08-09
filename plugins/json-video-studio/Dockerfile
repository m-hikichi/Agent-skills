FROM node:24.18.0-bookworm-slim AS build

WORKDIR /app

COPY runtime/package.json runtime/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY runtime/ ./
COPY schemas/ /schemas/

RUN npm run build

FROM build AS production-dependencies

RUN npm ci --omit=dev

FROM node:24.18.0-bookworm-slim AS runtime-base

ARG CHROMIUM_VERSION=151.0.7922.71-1~deb12u1
ARG FFMPEG_VERSION=7:5.1.9-0+deb12u1
ARG FONTCONFIG_VERSION=2.14.1-4
ARG NOTO_CJK_VERSION=1:20220127+repack1-1
ARG NOTO_MONO_VERSION=20201225-1
ARG CA_CERTIFICATES_VERSION=20230311+deb12u1

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    JSON_VIDEO_SCHEMA_PATH=/app/schemas/video-project.schema.json \
    JSON_VIDEO_WORKSPACE_ROOT=/workspace \
    JSON_VIDEO_DATA_ROOT=/data \
    JSON_VIDEO_UI_HOST=0.0.0.0 \
    JSON_VIDEO_ALLOW_CONTAINER_BIND=1 \
    JSON_VIDEO_UI_PORT=43120 \
    JSON_VIDEO_VOICEVOX_URL=http://voicevox:50021 \
    REMOTION_VERSION=4.0.503 \
    JSON_VIDEO_FONT_FAMILY="Noto Sans CJK JP" \
    CHROME_BIN=/usr/bin/chromium

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates=${CA_CERTIFICATES_VERSION} \
        chromium=${CHROMIUM_VERSION} \
        ffmpeg=${FFMPEG_VERSION} \
        fontconfig=${FONTCONFIG_VERSION} \
        fonts-noto-cjk=${NOTO_CJK_VERSION} \
        fonts-noto-mono=${NOTO_MONO_VERSION} \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

FROM runtime-base AS test

ENV NODE_ENV=test

COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/tsconfig.json ./tsconfig.json
COPY --from=build --chown=node:node /app/vitest.config.ts ./vitest.config.ts
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/tests ./tests
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --chown=node:node schemas ./schemas
COPY --chown=node:node schemas /schemas
COPY --chown=node:node examples /examples
COPY --chown=node:node runtime/playwright.config.ts ./playwright.config.ts
COPY --chown=node:node runtime/e2e ./e2e
RUN mkdir -p /app/test-results && chown -R node:node /app/test-results

USER node
ENTRYPOINT ["npm"]
CMD ["run", "test:e2e"]

FROM runtime-base AS runtime

WORKDIR /app

COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --chown=node:node schemas ./schemas
COPY --chown=node:node examples ./examples
COPY --chown=node:node THIRD_PARTY_NOTICES.md ./THIRD_PARTY_NOTICES.md

RUN mkdir -p /workspace /data && chown -R node:node /workspace /data

USER node
EXPOSE 43120
ENTRYPOINT ["node", "/app/dist/cli/index.js"]
CMD ["--help"]
