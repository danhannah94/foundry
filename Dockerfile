# ============================================
# Foundry — Multi-stage Docker Build (SSR)
# ============================================

# Stage 1: Build Astro SSR site
FROM node:22-alpine AS site-builder
WORKDIR /app
COPY packages/site/ packages/site/
# Create empty content directory — content is fetched at runtime
RUN mkdir -p packages/site/content
RUN cd packages/site && npm install && npm run build

# Stage 2: Build API
FROM node:22-alpine AS api-builder
WORKDIR /app/packages/api
COPY packages/api/package.json ./
RUN npm install
COPY packages/api/ ./
RUN npm run build

# Stage 3: Production runtime
FROM node:22-slim
WORKDIR /app

# Install native dependencies required by sqlite-vss + git for runtime content fetching
RUN apt-get update && apt-get install -y --no-install-recommends \
    libopenblas0 \
    libgomp1 \
    git \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Copy built artifacts
COPY --from=site-builder /app/packages/site/dist packages/site/dist
COPY --from=api-builder /app/packages/api/dist packages/api/dist
COPY --from=api-builder /app/packages/api/node_modules packages/api/node_modules
COPY --from=api-builder /app/packages/api/package.json packages/api/

# Copy entrypoint script
COPY scripts/start.sh scripts/start.sh
RUN chmod +x scripts/start.sh

# Fix cross-platform native modules (Alpine build → Debian runtime)
RUN cd packages/api && npm install --os=linux --cpu=x64 sharp
RUN cd packages/api && npm rebuild better-sqlite3
RUN cd packages/api/node_modules/sqlite-vss-linux-x64/lib && \
    ln -sf vss0.so vss0.so.so && \
    ln -sf vector0.so vector0.so.so

# Create data directory for SQLite and content directory for runtime fetching
RUN mkdir -p /data
RUN mkdir -p packages/site/content

# Environment
ENV PORT=4321
ENV FOUNDRY_DB_PATH=/data/foundry.db
ENV FOUNDRY_STATIC_PATH=/app/packages/site/dist
ENV NODE_ENV=production
ENV CONTENT_REPO=""
ENV CONTENT_BRANCH=main
ENV DEPLOY_KEY_PATH=""
ENV WEBHOOK_SECRET=""

EXPOSE 4321
VOLUME ["/data"]

CMD ["sh", "scripts/start.sh"]
