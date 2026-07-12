FROM node:20.19.4-bookworm-slim@sha256:6db5e436948af8f0244488a1f658c2c8e55a3ae51ca2e1686ed042be8f25f70a

ARG GOOGLE_FONTS_COMMIT=ec0464b978de222073645d6d3366f3fdf03376d8
ARG CHROMIUM_VERSION=150.0.7871.100-1~deb12u1
ARG NOTO_CJK_VERSION=1:20220127+repack1-1

RUN apt-get update && apt-get install -y \
    chromium="${CHROMIUM_VERSION}" \
    chromium-common="${CHROMIUM_VERSION}" \
    chromium-sandbox="${CHROMIUM_VERSION}" \
    fonts-noto-cjk="${NOTO_CJK_VERSION}" \
    fontconfig \
    ca-certificates \
    curl \
    dumb-init \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Immutable font URLs plus SHA-256 verification keep typography reproducible.
RUN mkdir -p /usr/share/fonts/google \
    && curl --fail --location --silent --show-error \
      "https://raw.githubusercontent.com/google/fonts/${GOOGLE_FONTS_COMMIT}/ofl/bizudpgothic/BIZUDPGothic-Regular.ttf" \
      -o /usr/share/fonts/google/BIZUDPGothic-Regular.ttf \
    && curl --fail --location --silent --show-error \
      "https://raw.githubusercontent.com/google/fonts/${GOOGLE_FONTS_COMMIT}/ofl/bizudpgothic/BIZUDPGothic-Bold.ttf" \
      -o /usr/share/fonts/google/BIZUDPGothic-Bold.ttf \
    && curl --fail --location --silent --show-error \
      "https://raw.githubusercontent.com/google/fonts/${GOOGLE_FONTS_COMMIT}/ofl/sourcecodepro/SourceCodePro%5Bwght%5D.ttf" \
      -o /usr/share/fonts/google/SourceCodePro.ttf \
    && curl --fail --location --silent --show-error \
      "https://raw.githubusercontent.com/google/fonts/${GOOGLE_FONTS_COMMIT}/ofl/sourcecodepro/SourceCodePro-Italic%5Bwght%5D.ttf" \
      -o /usr/share/fonts/google/SourceCodePro-Italic.ttf \
    && printf '%s  %s\n' \
      '258d7156c165f2ff774b6efee637c22c3b950de0d8a10e501137061bc8085d01' '/usr/share/fonts/google/BIZUDPGothic-Regular.ttf' \
      '30eba52fc837e8b62c97d4b82e6706583149fb7294e3712dd71a655eaea80a90' '/usr/share/fonts/google/BIZUDPGothic-Bold.ttf' \
      'b400fc584e10aff25d0e775ce181b4fc1c5ea1b5dc37b81aeb2084375b945790' '/usr/share/fonts/google/SourceCodePro.ttf' \
      '6db77d25aa7b30eff449305b5c998e475694c74d398421127ea5a60f536413cd' '/usr/share/fonts/google/SourceCodePro-Italic.ttf' \
      | sha256sum --check --strict \
    && fc-cache -f

RUN printf '%s\n' \
  '<?xml version="1.0"?>' \
  '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">' \
  '<fontconfig>' \
  '  <alias><family>sans-serif</family><prefer><family>Noto Sans CJK JP</family></prefer></alias>' \
  '  <alias><family>serif</family><prefer><family>Noto Serif CJK JP</family></prefer></alias>' \
  '  <alias><family>monospace</family><prefer><family>Source Code Pro</family><family>Noto Sans Mono CJK JP</family></prefer></alias>' \
  '</fontconfig>' \
  > /etc/fonts/conf.d/99-presentation-fonts.conf \
  && fc-cache -f

ENV CHROME_PATH=/usr/bin/chromium \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROME_DOWNLOAD=true \
    IS_DOCKER=true \
    LANG=C.UTF-8 \
    TZ=UTC \
    HOME=/tmp/marp-home \
    TMPDIR=/tmp \
    XDG_CACHE_HOME=/tmp/marp-cache \
    XDG_CONFIG_HOME=/tmp/marp-config \
    MARP_BIN=/app/node_modules/.bin/marp \
    MMDC_BIN=/app/node_modules/.bin/mmdc \
    PATH=/app/node_modules/.bin:$PATH

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN NODE_OPTIONS=--max-old-space-size=2048 npm run build \
    && node --test dist/tests.js \
    && npm prune --omit=dev \
    && npm cache clean --force

# The bind-mounted workspace is the only writable persistent location.
RUN mkdir -p /workspace && chown node:node /workspace
USER node
WORKDIR /workspace

ENTRYPOINT ["/usr/bin/dumb-init", "--", "node", "/app/dist/index.js"]
