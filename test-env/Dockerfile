# ============================================
# Foundry — Test Environment Dockerfile
# ============================================
# Clones the repo from GitHub at a specified branch, builds, and runs.
# No local file dependencies — the container is fully self-contained.
#
# Usage (via compose):
#   BRANCH=main docker compose -f docker-compose.yml -f test-env/compose.test.yml up -d --build
#
# Usage (direct):
#   docker build -f test-env/Dockerfile --build-arg BRANCH=main -t foundry-test .

ARG BRANCH=main

# Stage 0: Clone the repo
FROM node:22-alpine AS source
ARG BRANCH
RUN apk add --no-cache git
WORKDIR /repo
RUN git clone --depth 1 --branch ${BRANCH} \
      https://github.com/danhannah94/foundry.git .

# Stage 1: Build Astro SSR site
FROM node:22-alpine AS site-builder
WORKDIR /app
COPY --from=source /repo/packages/site/ packages/site/
RUN mkdir -p packages/site/content
RUN cd packages/site && npm install && npm run build

# Stage 2: Build API
FROM node:22-alpine AS api-builder
WORKDIR /app/packages/api
COPY --from=source /repo/packages/api/package.json ./
RUN npm install
COPY --from=source /repo/packages/api/ ./
RUN npm run build

# Stage 3: Production runtime
FROM node:22-slim
WORKDIR /app

# Install native dependencies required by sqlite-vss + git/ssh for GitHub sync
RUN apt-get update && apt-get install -y --no-install-recommends \
    libopenblas0 \
    libgomp1 \
    git \
    openssh-client \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy built artifacts
COPY --from=site-builder /app/packages/site/dist packages/site/dist
COPY --from=site-builder /app/packages/site/node_modules packages/site/node_modules
COPY --from=site-builder /app/packages/site/package.json packages/site/
COPY --from=api-builder /app/packages/api/dist packages/api/dist
COPY --from=api-builder /app/packages/api/node_modules packages/api/node_modules
COPY --from=api-builder /app/packages/api/package.json packages/api/

# Copy config and scripts from cloned repo
COPY --from=source /repo/foundry.config.yaml foundry.config.yaml
COPY --from=source /repo/nav.yaml nav.yaml
COPY --from=source /repo/scripts/start.sh scripts/start.sh
COPY --from=source /repo/scripts/proxy.mjs scripts/proxy.mjs
RUN chmod +x scripts/start.sh

# Fix cross-platform native modules (Alpine build → Debian runtime)
RUN cd packages/api && npm install --os=linux --cpu=x64 sharp
RUN cd packages/api && npm rebuild better-sqlite3
RUN cd packages/api/node_modules/sqlite-vss-linux-x64/lib && \
    ln -sf vss0.so vss0.so.so && \
    ln -sf vector0.so vector0.so.so

# Create data directory and pre-populate with test fixture markdown
RUN mkdir -p /data/docs
COPY --from=source /repo/test-env/seed/fixtures/content/ /data/docs/

# Environment
ENV PORT=4321
ENV FOUNDRY_DB_PATH=/data/foundry.db
ENV FOUNDRY_STATIC_PATH=/app/packages/site/dist
ENV NODE_ENV=production
ENV DEPLOY_KEY_PATH=""
ENV SYNC_REMOTE_URL=""
ENV CONTENT_DIR=/data/docs
ENV FOUNDRY_READ_TOKEN=""

EXPOSE 4321
VOLUME ["/data"]

CMD ["sh", "scripts/start.sh"]
