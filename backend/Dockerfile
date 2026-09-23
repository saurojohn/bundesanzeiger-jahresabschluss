# ============================================================================
# Bundesanzeiger Jahresabschluss — Backend Dockerfile (Multi-Stage)
# ============================================================================
# Stage 1: Builder — installiert deps, generiert Prisma Client, baut TS.
# Stage 2: Runtime — nur Node + dist + Prisma Client, kein devDeps.
# ============================================================================

# ----------------------------------------------------------------------------
# Stage 1: Builder
# ----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Native Build-Tools (für bcrypt / Prisma bei Bedarf)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 build-essential openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Dependencies separat cachen
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

# Prisma Schema + generierter Client
COPY prisma/ ./prisma/
RUN npx prisma generate

# Source + Build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# ----------------------------------------------------------------------------
# Stage 2: Runtime
# ----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Nur Production-Deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

# Prisma Client + Schema (für `prisma migrate deploy` zur Laufzeit)
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY prisma/ ./prisma/

# Build-Output
COPY --from=builder /app/dist ./dist

# Non-root user
RUN groupadd -g 1001 nodejs && useradd -M -u 1001 -g nodejs nodejs && chown -R nodejs:nodejs /app
USER nodejs

EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode < 500 ? 0 : 1))"

CMD ["node", "dist/main.js"]
