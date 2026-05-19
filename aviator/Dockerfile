FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
# Next.js inlines NEXT_PUBLIC_* at build time. They must be present in env
# when `next build` runs — supplying via runtime container env does nothing.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_AUCTIONS_URL
ARG NEXT_PUBLIC_EXCHANGE_URL
# Feature flag for the astronaut-on-rocket stage (vs. the legacy plane
# canvas). Set to "1" in build args to ship the rocket art; omit /
# leave empty to keep the plane. The flag must be set at build time
# because Next.js inlines NEXT_PUBLIC_* — runtime env won't flip it.
ARG NEXT_PUBLIC_AVIATOR_ROCKET
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_AUCTIONS_URL=$NEXT_PUBLIC_AUCTIONS_URL
ENV NEXT_PUBLIC_EXCHANGE_URL=$NEXT_PUBLIC_EXCHANGE_URL
ENV NEXT_PUBLIC_AVIATOR_ROCKET=$NEXT_PUBLIC_AVIATOR_ROCKET
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
RUN addgroup -S nextjs && adduser -S nextjs -G nextjs
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/next.config.ts ./next.config.ts
USER nextjs
EXPOSE 3000
CMD ["npm","run","start"]
