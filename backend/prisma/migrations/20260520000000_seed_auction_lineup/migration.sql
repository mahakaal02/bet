-- Seed the auctions catalog with a mix of LIVE / UPCOMING / ENDED rows so
-- the three tabs on /auctions have content out of the box. Idempotent —
-- every INSERT uses `ON CONFLICT (id) DO NOTHING` keyed on a stable
-- `seed-*` id, so re-running this migration (or re-rolling pods) is a
-- no-op once the rows exist.
--
-- Why this lives in a migration (rather than the seed script in
-- prisma/seed.ts): the `prisma-migrate` init container in helm/kalki is
-- the proven, always-runs path on every backend deploy. The
-- `prisma-seed` init container we added in PR #24 hasn't reliably
-- produced the rows on the live cluster — so we land this data via
-- the migration channel that's already known-good.
--
-- ENDED rows reference the seeded demo users (user1/2/3@kalki.local).
-- If those rows haven't been ensured yet (first-deploy edge case), the
-- subquery returns no row and the INSERT is skipped — re-running once
-- the users exist will fill them in. The seed script + the `User` row
-- creation path on first sign-in both create those accounts.
--
-- `imageUrls` is `'{}'` (empty PG array) on every row. Operators upload
-- product photos through the admin surface; the gallery renderer falls
-- back to a 🛒 placeholder until then. The `Auction` model defines
-- `imageUrls String[] @default([])` (see schema.prisma), so any
-- subsequent operator upload writes into the same column we leave
-- empty here.

-- ─── Demo users (anchors for the ENDED winnerId references) ────────
-- bcrypt(10) hash for "password12345" — matches what `prisma/seed.ts`
-- writes at runtime. Bare `ON CONFLICT DO NOTHING` (no inference
-- column) treats *any* unique-constraint violation as a skip — both
-- `email` and `username` carry @unique indexes on User, so a row
-- where either already exists is left untouched.
INSERT INTO "User" (id, email, username, "passwordHash", "emailVerified")
VALUES
  (gen_random_uuid(), 'user1@kalki.local', 'user1', '$2b$10$gJ19ChipHiZYi4r.lm3JLeAMvx0Rv06qUL/Zx34YaSGSjNLMA6UES', true),
  (gen_random_uuid(), 'user2@kalki.local', 'user2', '$2b$10$gJ19ChipHiZYi4r.lm3JLeAMvx0Rv06qUL/Zx34YaSGSjNLMA6UES', true),
  (gen_random_uuid(), 'user3@kalki.local', 'user3', '$2b$10$gJ19ChipHiZYi4r.lm3JLeAMvx0Rv06qUL/Zx34YaSGSjNLMA6UES', true)
ON CONFLICT DO NOTHING;

-- ─── LIVE auctions ─────────────────────────────────────────────────
-- `startsAt` in the past, `endsAt` in the future, status LIVE.
INSERT INTO "Auction"
  (id, title, description, "imageUrls", "retailPrice", "coinsPerBid",
   "startsAt", "endsAt", status, "manipulationMode")
VALUES
  ('seed-sony-headphones',
   'Sony WH-1000XM5',
   'Industry-leading noise-cancelling wireless headphones. Premium ANC, 30-hour battery, and adaptive sound across calls and music.',
   '{}',
   29990.00, 1,
   NOW() - INTERVAL '1 hour',  NOW() + INTERVAL '6 hours',
   'LIVE', 'NORMAL'),

  ('seed-macbook-air-m4',
   'MacBook Air M4 (13-inch, 256 GB)',
   'Apple silicon M4 chip, 13-inch Liquid Retina display, 18-hour battery, fanless design. Mid-spec configuration in Sky Blue.',
   '{}',
   114900.00, 4,
   NOW() - INTERVAL '2 hours', NOW() + INTERVAL '10 hours',
   'LIVE', 'NORMAL'),

  ('seed-dji-mavic-4',
   'DJI Mavic 4 Pro',
   'Flagship triple-camera drone, Hasselblad main sensor, 50-min flight time, 4K/120p slow motion. Standard Fly More combo.',
   '{}',
   199900.00, 5,
   NOW() - INTERVAL '30 minutes', NOW() + INTERVAL '14 hours',
   'LIVE', 'NORMAL'),

  ('seed-bose-qcue',
   'Bose QuietComfort Ultra Earbuds',
   'Immersive Audio spatial mix, world-class noise cancellation, 6-hour battery in-ear + 24 hours with case.',
   '{}',
   26990.00, 2,
   NOW() - INTERVAL '15 minutes', NOW() + INTERVAL '2 hours',
   'LIVE', 'NORMAL')
ON CONFLICT (id) DO NOTHING;

-- ─── UPCOMING auctions ─────────────────────────────────────────────
-- `startsAt` in the future. Scheduler will flip status to LIVE on
-- arrival (see `backend/src/auctions/auctions.scheduler.ts`).
INSERT INTO "Auction"
  (id, title, description, "imageUrls", "retailPrice", "coinsPerBid",
   "startsAt", "endsAt", status, "manipulationMode")
VALUES
  ('seed-iphone-16-pro-max',
   'iPhone 16 Pro Max (256 GB)',
   'A18 Pro chip, 6.9-inch Super Retina XDR, titanium frame, 5x telephoto camera. Desert Titanium finish.',
   '{}',
   144900.00, 5,
   NOW() + INTERVAL '2 days', NOW() + INTERVAL '4 days',
   'UPCOMING', 'NORMAL'),

  ('seed-ps5-pro',
   'PlayStation 5 Pro (2 TB)',
   'Sony PS5 Pro with custom AMD GPU, 2 TB SSD, ray-tracing acceleration. Includes one DualSense Edge controller.',
   '{}',
   79990.00, 3,
   NOW() + INTERVAL '1 day', NOW() + INTERVAL '3 days',
   'UPCOMING', 'NORMAL'),

  ('seed-canon-r5-mk2',
   'Canon EOS R5 Mark II',
   '45 MP full-frame mirrorless, 8K30 raw video, in-body image stabilisation. Body only — bring your own RF glass.',
   '{}',
   349990.00, 6,
   NOW() + INTERVAL '3 days', NOW() + INTERVAL '6 days',
   'UPCOMING', 'NORMAL')
ON CONFLICT (id) DO NOTHING;

-- ─── ENDED auctions ────────────────────────────────────────────────
-- status ENDED, with winnerId + winnerAmount + closedAt set. The
-- closed-tab tile surfaces both. Each row uses a `SELECT … FROM "User"`
-- subquery to resolve the demo username to a UUID at insert time — if
-- the user row doesn't exist yet (rare first-deploy edge case), the
-- whole INSERT for that auction skips, and a re-run lands it.
INSERT INTO "Auction"
  (id, title, description, "imageUrls", "retailPrice", "coinsPerBid",
   "startsAt", "endsAt", status, "manipulationMode",
   "winnerId", "winnerAmount", "closedAt")
SELECT
  'seed-apple-watch-ultra-2',
  'Apple Watch Ultra 2',
  'Titanium case, 36-hour battery, dual-frequency GPS, action button. Trail Loop band.',
  '{}'::text[],
  89900.00, 3,
  NOW() - INTERVAL '7 days', NOW() - INTERVAL '5 days',
  'ENDED', 'NORMAL',
  u.id, 9.42, NOW() - INTERVAL '5 days'
FROM "User" u WHERE u.email = 'user1@kalki.local'
ON CONFLICT (id) DO NOTHING;

INSERT INTO "Auction"
  (id, title, description, "imageUrls", "retailPrice", "coinsPerBid",
   "startsAt", "endsAt", status, "manipulationMode",
   "winnerId", "winnerAmount", "closedAt")
SELECT
  'seed-switch-oled',
  'Nintendo Switch OLED (White)',
  'Vivid 7-inch OLED screen, enhanced audio, 64 GB internal storage. Includes Joy-Con pair + dock.',
  '{}'::text[],
  36990.00, 2,
  NOW() - INTERVAL '10 days', NOW() - INTERVAL '7 days',
  'ENDED', 'NORMAL',
  u.id, 13.27, NOW() - INTERVAL '7 days'
FROM "User" u WHERE u.email = 'user2@kalki.local'
ON CONFLICT (id) DO NOTHING;

INSERT INTO "Auction"
  (id, title, description, "imageUrls", "retailPrice", "coinsPerBid",
   "startsAt", "endsAt", status, "manipulationMode",
   "winnerId", "winnerAmount", "closedAt")
SELECT
  'seed-royal-enfield-hunter',
  'Royal Enfield Hunter 350',
  'Roadster styling, 349cc air-cooled J-platform engine, dual-channel ABS. Dapper Ash colourway.',
  '{}'::text[],
  175000.00, 6,
  NOW() - INTERVAL '14 days', NOW() - INTERVAL '10 days',
  'ENDED', 'NORMAL',
  u.id, 47.51, NOW() - INTERVAL '10 days'
FROM "User" u WHERE u.email = 'user3@kalki.local'
ON CONFLICT (id) DO NOTHING;
