-- Seed: two feature flags that gate the new outbox pipeline.
--
-- `outbox.enabled` is the master switch for the dispatch worker —
-- OFF lets rows pile up in PENDING without firing side effects.
-- Useful for migration windows or kill-switch scenarios.
--
-- `outbox.bid_wallet_debit` controls whether `BidsService.placeBid()`
-- writes its wallet debit to the outbox (ON, the audited correct
-- path) or fires a synchronous HTTP debit with bid rollback on
-- failure (OFF, the legacy path). Starts OFF so we can canary the
-- new path per-user-cohort.
--
-- Both default OFF. ON CONFLICT DO NOTHING so re-running is safe.

INSERT INTO "FeatureFlag" (id, description, mode, enabled, "rolloutPercent", "updatedAt", "createdAt")
VALUES
  ('outbox.enabled',
   'Master switch for the outbox dispatch worker. When OFF, Outbox rows accumulate but no side effects fire. Flip ON after verifying schema is healthy and no stale rows are present.',
   'BOOLEAN', false, 0, NOW(), NOW()),
  ('outbox.bid_wallet_debit',
   'When ON, BidsService.placeBid() writes the wallet debit to the outbox (atomic, retried via dispatcher). When OFF, the legacy synchronous-HTTP-with-rollback path runs. Audit PR #28 finding #8 fix.',
   'BOOLEAN', false, 0, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;
