# Build context must be the repo root (not worker/), since this depends on the
# sibling db/ package via "file:../db". On Render: set Dockerfile Path to
# worker/Dockerfile and Docker Build Context Directory to the repo root.
FROM node:20-slim

RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation libnss3 libatk-bridge2.0-0 libgtk-3-0 \
    libxss1 libasound2 --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app/db
COPY db/package*.json ./
RUN npm install --omit=dev
COPY db/ ./

WORKDIR /app/worker
COPY worker/package*.json ./
RUN npm ci --omit=dev
COPY worker/ ./

CMD ["node", "src/index.js"]
