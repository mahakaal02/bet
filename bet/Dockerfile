# Bet — production image. Debian base (bookworm-slim) so Prisma's OpenSSL 3
# detection works out of the box.
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
# Next.js inlines NEXT_PUBLIC_* at build time. They must be present in env
# when `next build` runs — supplying via runtime container env does nothing.
ARG NEXT_PUBLIC_AUCTIONS_URL
ARG NEXT_PUBLIC_AVIATOR_URL
ARG NEXT_PUBLIC_BACKEND_URL
ARG NEXT_PUBLIC_GOOGLE_ENABLED
ENV NEXT_PUBLIC_AUCTIONS_URL=$NEXT_PUBLIC_AUCTIONS_URL
ENV NEXT_PUBLIC_AVIATOR_URL=$NEXT_PUBLIC_AVIATOR_URL
ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL
ENV NEXT_PUBLIC_GOOGLE_ENABLED=$NEXT_PUBLIC_GOOGLE_ENABLED
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
RUN groupadd --system nextjs && useradd --system --gid nextjs nextjs
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
USER nextjs
EXPOSE 3100
CMD ["npm","run","start"]
