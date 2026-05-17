# UniqueBid · Aviator (Next.js)

Slice 3: working realtime multiplier game UI against the existing NestJS
backend at `:4000`. Dark-only, premium casino aesthetic per the spec.

## Run

```bash
cd aviator
cp .env.local.example .env.local
npm install
npm run dev          # http://localhost:3000
```

The backend at `:4000` must be running (`cd backend && npm run start:dev`).
Sign in with any seeded user (`demo1@uniquebid.local` / `demo1234`).

## Android WebView pass-through

Pass `?token=<jwt>` to the URL and the page will store it in localStorage and
land you straight on the game without a login round-trip:

```
http://10.0.2.2:3000/?token=eyJhbGciOi...
```

## What's wired in Slice 3

- Sign-in / sign-out against the shared `/auth/login` endpoint
- Socket.io connection with auto-reconnect; receives:
  `STATE_SNAPSHOT`, `GAME_START`, `GAME_RUNNING`, `MULTIPLIER_UPDATE`,
  `GAME_CRASH`, `RECENT_WINNERS`, `CHAT_HISTORY`, `CHAT_MESSAGE`,
  `PLAYER_CASHOUT`, `ONLINE_COUNT`
- Zustand store as single source of truth for game + user state
- REST priming for balance + history on mount
- Phase-aware bet controls (PLACE BET → CASHOUT → BET LOCKED states)
- History strip with color-coded crash multipliers
- CSS screen-shake on `CRASHED`
- Glassmorphism panels, neon glow on the multiplier number

## Deferred to later slices

- **Slice 4** — PixiJS / HTML5 canvas plane trajectory, particle crash effect,
  smoothed multiplier animation
- **Slice 5** — chat panel, recent winners panel, player roster panel
- **Slice 6** — admin pages (seed rotation UI, round analytics, fairness
  verification)
- **Slice 7** — auto-bet mode, keyboard shortcuts, sound, accessibility, Docker
