-- Crash-engine settings catalog. All disabled-by-default so this
-- migration is a no-op until an operator flips
-- `aviator.crash.engine` → 'heavytail' through the admin UI.
--
-- Keys match the dotted convention expected by `SettingsService`;
-- env-var fallbacks use the SHOUTING_SNAKE translation
-- (e.g. AVIATOR_CRASH_ENGINE) for boxes that prefer env-driven
-- config.
--
-- ON CONFLICT DO NOTHING — safe to re-run; never overwrites an
-- admin-set row.

INSERT INTO "SystemSetting" (key, value, "valueType", description, "updatedAt", "createdAt")
VALUES
  ('aviator.crash.engine',
   '"legacy"'::jsonb, 'STRING',
   'Which crash-multiplier engine drives rounds. ''legacy'' = the existing power-law (1-in-33 insta-crash, ~3% edge); ''heavytail'' = the configurable heavy-tail engine that respects aviator.crash.rtp, aviator.crash.mode, and exposure adaptation. Default ''legacy'' so existing seed audits remain reproducible byte-for-byte until an operator opts in.',
   NOW(), NOW()),

  ('aviator.crash.rtp',
   '0.96'::jsonb, 'FLOAT',
   'Target return-to-player (1 - house edge). Heavy-tail engine re-solves the Pareto tail exponent each round so realised RTP converges to this target. Compliance-sensitive — must match the value advertised to players. Typical range 0.94–0.99.',
   NOW(), NOW()),

  ('aviator.crash.mode',
   '"balanced"'::jsonb, 'STRING',
   'Base volatility mode for the heavy-tail engine: ''balanced'' (default PDF histogram), ''fast_loss'' (more insta-crashes, thinner tail — house-protection bias), or ''streamer'' (fatter tail for screenshot moments — promotional bias). Adaptive blending around this baseline is controlled by aviator.crash.adaptive_enabled.',
   NOW(), NOW()),

  ('aviator.crash.adaptive_enabled',
   'true'::jsonb, 'BOOL',
   'When ON, the engine blends BALANCED with FAST_LOSS / STREAMER based on a smoothed exposure factor (EMA of round-level stake). When OFF, the chosen aviator.crash.mode is used as-is. Adaptive blending preserves the long-run RTP — only short-term variance shifts.',
   NOW(), NOW()),

  ('aviator.crash.alpha',
   '0.2'::jsonb, 'FLOAT',
   'EMA decay used by the exposure tracker. New rounds contribute this much weight to the running average; higher = more reactive, lower = more stable. Range (0, 1]. Default 0.2 ≈ 20-round half-life.',
   NOW(), NOW()),

  ('aviator.crash.blend_strength',
   '0.2'::jsonb, 'FLOAT',
   'Round-by-round magnitude of the exposure factor — bigger values make the adaptive blend more aggressive. Range (0, 1]. Default 0.2 (PDF recommendation).',
   NOW(), NOW()),

  ('aviator.crash.reference_stake',
   '5000'::jsonb, 'INT',
   'Reference per-round stake (in coins) for the exposure factor''s log-ratio normalisation. Exposure crosses 0 when the smoothed round stake equals this value. Tune to the live traffic baseline so BALANCED is the typical mode in healthy conditions.',
   NOW(), NOW())
ON CONFLICT (key) DO NOTHING;
