FROM node:20-slim

# Install Chromium and Japanese fonts for PDF/PPTX export
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-noto-cjk \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Chromium settings for Docker environment
ENV CHROME_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV IS_DOCKER=true

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
