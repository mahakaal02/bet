-- PR-PROFILE-2: admin moderation queue on UserProfileHistory.

CREATE TYPE "ProfileReviewAction" AS ENUM ('NONE', 'PENDING', 'KEPT_AS_IS', 'FORCED_RENAME');

ALTER TABLE "UserProfileHistory"
  ADD COLUMN "flagReason"   text,
  ADD COLUMN "reviewAction" "ProfileReviewAction" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "reviewedAt"   timestamp(3),
  ADD COLUMN "reviewedBy"   text,
  ADD COLUMN "reviewNotes"  text;

CREATE INDEX "UserProfileHistory_reviewAction_changedAt_idx"
  ON "UserProfileHistory" ("reviewAction", "changedAt");
