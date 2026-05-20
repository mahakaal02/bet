-- PR-FRAUD-1: FraudSignal table + enums.

CREATE TYPE "FraudSignalKind" AS ENUM (
  'VELOCITY_BID',
  'VELOCITY_LOGIN',
  'VELOCITY_WITHDRAWAL',
  'CLUSTER_IP',
  'CLUSTER_DEVICE',
  'CLUSTER_REFERRAL'
);

CREATE TYPE "FraudSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

CREATE TABLE "FraudSignal" (
  "id"              text             PRIMARY KEY,
  "kind"            "FraudSignalKind" NOT NULL,
  "severity"        "FraudSeverity"   NOT NULL,
  "userId"          text,
  "clusterKey"      text,
  "affectedUserIds" jsonb,
  "metadata"        jsonb            NOT NULL,
  "reviewed"        boolean          NOT NULL DEFAULT false,
  "reviewedBy"      text,
  "reviewedAt"      timestamp(3),
  "notes"           text,
  "createdAt"       timestamp(3)     NOT NULL DEFAULT NOW()
);
CREATE INDEX "FraudSignal_reviewed_severity_createdAt_idx"
  ON "FraudSignal" ("reviewed", "severity", "createdAt");
CREATE INDEX "FraudSignal_userId_createdAt_idx"
  ON "FraudSignal" ("userId", "createdAt");
CREATE INDEX "FraudSignal_clusterKey_kind_idx"
  ON "FraudSignal" ("clusterKey", "kind");

-- Threshold settings — admin-editable so the security team can
-- re-tune without redeploying. Defaults err on the side of low
-- noise; tighten as we collect production data.

INSERT INTO "SystemSetting" (key, value, "valueType", description, "updatedAt", "createdAt")
VALUES
  ('fraud.velocity_bid_count',     '30'::jsonb, 'INT',
   'Bids in window before VELOCITY_BID signal fires.', NOW(), NOW()),
  ('fraud.velocity_bid_window_ms', '60000'::jsonb, 'INT',
   'Time window (ms) for VELOCITY_BID. Default 60s.', NOW(), NOW()),
  ('fraud.cluster_ip_min_users',   '3'::jsonb, 'INT',
   'Distinct users sharing one signup IP before CLUSTER_IP fires.', NOW(), NOW()),
  ('fraud.cluster_device_min_users','3'::jsonb, 'INT',
   'Distinct users sharing one device hash before CLUSTER_DEVICE fires.', NOW(), NOW()),
  ('fraud.cluster_referral_min_referees', '5'::jsonb, 'INT',
   'Referees per referrer in 24h before CLUSTER_REFERRAL fires.', NOW(), NOW())
ON CONFLICT (key) DO NOTHING;

-- Feature flag for production rollout.
INSERT INTO "FeatureFlag" (id, enabled, description, "updatedAt", "createdAt")
VALUES
  ('fraud.evaluator_enabled',
   false,
   'When ON, FraudEvaluator runs on user signup / login / bid / referral. Off by default — flip after the security team has reviewed the threshold settings.',
   NOW(), NOW())
ON CONFLICT (id) DO NOTHING;
