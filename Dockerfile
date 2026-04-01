# ============================================
# Foundry — Multi-stage Docker Build
# ============================================

# Stage 1: Fetch content from source repos
FROM node:22-alpine AS content-fetcher
RUN apk add --no-cache git bash
WORKDIR /app
COPY package*.json ./
COPY foundry.config.yaml nav.yaml ./
COPY scripts/ scripts/
COPY packages/site/package*.json packages/site/
COPY packages/api/package*.json packages/api/
RUN npm ci
ARG GITHUB_TOKEN=""
ARG CACHE_BUST=""
ENV GITHUB_TOKEN=${GITHUB_TOKEN}
RUN bash scripts/build.sh

# Stage 2: Build static site
FROM node:22-alpine AS site-builder
WORKDIR /app
COPY packages/site/ packages/site/
COPY --from=content-fetcher /app/packages/site/content packages/site/content
COPY nav.yaml ./
RUN cd packages/site && npm ci && npm run build

# Stage 3: Build API
FROM node:22-alpine AS api-builder
WORKDIR /app/packages/api
COPY packages/api/package.json ./
RUN npm install
COPY packages/api/ ./
RUN npm run build

# Stage 4: Production runtime
FROM node:22-slim
WORKDIR /app

# Install native dependencies required by sqlite-vss
RUN apt-get update && apt-get install -y --no-install-recommends \
    libopenblas0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Copy built artifacts
COPY --from=site-builder /app/packages/site/dist packages/site/dist
COPY --from=api-builder /app/packages/api/dist packages/api/dist
COPY --from=api-builder /app/packages/api/node_modules packages/api/node_modules
COPY --from=api-builder /app/packages/api/package.json packages/api/
COPY foundry.config.yaml nav.yaml ./

# Fix cross-platform native modules (Alpine build → Debian runtime)
RUN cd packages/api && npm install --os=linux --cpu=x64 sharp
RUN cd packages/api && npm rebuild better-sqlite3
RUN cd packages/api/node_modules/sqlite-vss-linux-x64/lib && \
    ln -sf vss0.so vss0.so.so && \
    ln -sf vector0.so vector0.so.so

# Create data directory for SQLite
RUN mkdir -p /data

# Environment
ENV PORT=3001
ENV FOUNDRY_DB_PATH=/data/foundry.db
ENV FOUNDRY_STATIC_PATH=/app/packages/site/dist
ENV NODE_ENV=production

EXPOSE 3001
VOLUME ["/data"]

CMD ["node", "packages/api/dist/index.js"]