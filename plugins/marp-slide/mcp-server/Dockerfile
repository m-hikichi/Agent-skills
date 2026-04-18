FROM node:20-slim

# Install Chromium, fonts, and tools for font downloads.
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-noto-cjk \
    fontconfig \
    ca-certificates \
    curl \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Install Google Fonts not available via apt.
#   - BIZ UDPGothic : headings (Japanese UD gothic)
#   - Source Code Pro: code blocks (monospace)
# Noto Sans CJK JP (body) and Noto Serif CJK JP (quotes) are from apt above.
RUN mkdir -p /usr/share/fonts/google && \
    curl -sL "https://github.com/google/fonts/raw/main/ofl/bizudpgothic/BIZUDPGothic-Regular.ttf" \
      -o /usr/share/fonts/google/BIZUDPGothic-Regular.ttf && \
    curl -sL "https://github.com/google/fonts/raw/main/ofl/bizudpgothic/BIZUDPGothic-Bold.ttf" \
      -o /usr/share/fonts/google/BIZUDPGothic-Bold.ttf && \
    curl -sL "https://github.com/google/fonts/raw/main/ofl/sourcecodepro/SourceCodePro%5Bwght%5D.ttf" \
      -o /usr/share/fonts/google/SourceCodePro.ttf && \
    curl -sL "https://github.com/google/fonts/raw/main/ofl/sourcecodepro/SourceCodePro-Italic%5Bwght%5D.ttf" \
      -o /usr/share/fonts/google/SourceCodePro-Italic.ttf

# Configure fontconfig: prefer Japanese glyphs for generic families.
RUN printf '<?xml version="1.0"?>\n\
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n\
<fontconfig>\n\
  <alias>\n\
    <family>sans-serif</family>\n\
    <prefer>\n\
      <family>Noto Sans CJK JP</family>\n\
    </prefer>\n\
  </alias>\n\
  <alias>\n\
    <family>serif</family>\n\
    <prefer>\n\
      <family>Noto Serif CJK JP</family>\n\
    </prefer>\n\
  </alias>\n\
  <alias>\n\
    <family>monospace</family>\n\
    <prefer>\n\
      <family>Source Code Pro</family>\n\
      <family>Noto Sans Mono CJK JP</family>\n\
    </prefer>\n\
  </alias>\n\
</fontconfig>\n' > /etc/fonts/conf.d/99-presentation-fonts.conf && \
    fc-cache -fv

# Chromium settings for Docker environment
ENV CHROME_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV IS_DOCKER=true
ENV LANG=C.UTF-8

# Install Marp CLI globally
RUN npm install -g @marp-team/marp-cli

# Build MCP server
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# Workspace mount point
WORKDIR /workspace

ENTRYPOINT ["node", "/app/dist/index.js"]
