FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
# Pin the runtime UID/GID so the helm chart can set a matching `fsGroup`
# on the pod. Without a pinned GID, the longhorn-provisioned PVC at
# `/app/uploads` mounts root-owned, and the nodejs user can't write
# upload artefacts — every POST /admin/uploads then 500s.
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nodejs
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
# prisma/seed.ts uses ts-node and imports decorator-free helpers from
# src/pricing/ at runtime — must ship them or the seed init container
# can't compile the .ts file.
COPY --from=builder /app/src/pricing ./src/pricing
RUN mkdir -p /app/uploads && chown -R nodejs:nodejs /app
USER nodejs
EXPOSE 4000
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["node","dist/src/main.js"]
