-- PR-RECON-1: nightly reconciliation reports + per-user discrepancies.

CREATE TYPE "ReconciliationStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "ReconciliationReport" (
  "id"              text                   PRIMARY KEY,
  "forDate"         timestamp(3)           NOT NULL UNIQUE,
  "status"          "ReconciliationStatus" NOT NULL DEFAULT 'RUNNING',
  "startedAt"       timestamp(3)           NOT NULL DEFAULT NOW(),
  "completedAt"     timestamp(3),
  "failureReason"   text,
  "usersChecked"    integer                NOT NULL DEFAULT 0,
  "usersOk"         integer                NOT NULL DEFAULT 0,
  "usersDiscrepant" integer                NOT NULL DEFAULT 0,
  "totalAbsDrift"   integer                NOT NULL DEFAULT 0,
  "createdAt"       timestamp(3)           NOT NULL DEFAULT NOW()
);
CREATE INDEX "ReconciliationReport_status_forDate_idx"
  ON "ReconciliationReport" ("status", "forDate");

CREATE TABLE "ReconciliationDiscrepancy" (
  "id"           text         PRIMARY KEY,
  "reportId"     text         NOT NULL REFERENCES "ReconciliationReport"("id") ON DELETE CASCADE,
  "userId"       text         NOT NULL,
  "localSum"     integer      NOT NULL,
  "remoteSum"    integer      NOT NULL,
  "drift"        integer      NOT NULL,
  "notes"        text,
  "acknowledged" boolean      NOT NULL DEFAULT false,
  "ackedBy"      text,
  "ackedAt"      timestamp(3),
  "createdAt"    timestamp(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX "ReconciliationDiscrepancy_reportId_drift_idx"
  ON "ReconciliationDiscrepancy" ("reportId", "drift");
CREATE INDEX "ReconciliationDiscrepancy_userId_createdAt_idx"
  ON "ReconciliationDiscrepancy" ("userId", "createdAt");

-- Feature flag: nightly run defaults OFF until first prod walkthrough.
INSERT INTO "FeatureFlag" (id, enabled, description, "updatedAt", "createdAt")
VALUES
  ('reconciliation.enabled',
   false,
   'When ON, ReconciliationWorker runs the nightly compare-CoinTransaction-vs-Bet-balance job. Flip after the on-call team has rehearsed the discrepancy review workflow.',
   NOW(), NOW())
ON CONFLICT (id) DO NOTHING;
