-- Singleton admin-tunable knobs for Aviator:
--   - maxPayout         : optional global ceiling applied AFTER the
--                         provably-fair crash multiplier is computed,
--                         so the cap doesn't affect odds — it just
--                         clips the published value. NULL = uncapped.
--   - forcedNextPayout  : one-shot override consumed by the round
--                         scheduler at the start of the next BETTING
--                         phase, then cleared in the same transaction
--                         so it fires exactly once.

CREATE TABLE "AviatorSettings" (
    "id"               INTEGER         NOT NULL DEFAULT 1,
    "maxPayout"        DECIMAL(10,2),
    "forcedNextPayout" DECIMAL(10,2),
    "updatedAt"        TIMESTAMP(3)    NOT NULL,
    CONSTRAINT "AviatorSettings_pkey" PRIMARY KEY ("id")
);

-- Seed the singleton row so the service can always UPDATE without
-- worrying about a missing row.
INSERT INTO "AviatorSettings" ("id", "updatedAt")
VALUES (1, NOW());
