FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
# Next.js inlines NEXT_PUBLIC_* at build time. They must be present in env
# when `next build` runs — supplying via runtime container env does nothing.
ARG NEXT_PUBLIC_AUCTIONS_URL
ARG NEXT_PUBLIC_AVIATOR_URL
ARG NEXT_PUBLIC_BACKEND_URL
ARG NEXT_PUBLIC_EXCHANGE_URL
ARG NEXT_PUBLIC_ADMIN_URL
# Shared parent domain so the hub country pick (kalki_locale cookie) is
# sent to the bet/aviator subdomains too. See lib/locale-constants.ts.
ARG NEXT_PUBLIC_COOKIE_DOMAIN
ARG NEXT_PUBLIC_TELEGRAM_BOT
ENV NEXT_PUBLIC_AUCTIONS_URL=$NEXT_PUBLIC_AUCTIONS_URL
ENV NEXT_PUBLIC_AVIATOR_URL=$NEXT_PUBLIC_AVIATOR_URL
ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL
ENV NEXT_PUBLIC_EXCHANGE_URL=$NEXT_PUBLIC_EXCHANGE_URL
ENV NEXT_PUBLIC_ADMIN_URL=$NEXT_PUBLIC_ADMIN_URL
ENV NEXT_PUBLIC_COOKIE_DOMAIN=$NEXT_PUBLIC_COOKIE_DOMAIN
ENV NEXT_PUBLIC_TELEGRAM_BOT=$NEXT_PUBLIC_TELEGRAM_BOT
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3200
RUN addgroup -S nextjs && adduser -S nextjs -G nextjs
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/next.config.ts ./next.config.ts
USER nextjs
EXPOSE 3200
CMD ["npm","run","start"]
