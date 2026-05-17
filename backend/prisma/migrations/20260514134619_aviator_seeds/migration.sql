-- AlterTable
ALTER TABLE "AviatorRound" ADD COLUMN     "nonce" INTEGER,
ADD COLUMN     "seedId" TEXT;

-- CreateTable
CREATE TABLE "AviatorFairnessSeed" (
    "id" TEXT NOT NULL,
    "serverSeed" TEXT NOT NULL,
    "serverSeedHash" TEXT NOT NULL,
    "clientSeed" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revealedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "rotationReason" TEXT,
    "startRoundNumber" INTEGER,
    "endRoundNumber" INTEGER,

    CONSTRAINT "AviatorFairnessSeed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AviatorFairnessSeed_serverSeedHash_key" ON "AviatorFairnessSeed"("serverSeedHash");

-- CreateIndex
CREATE INDEX "AviatorFairnessSeed_isActive_idx" ON "AviatorFairnessSeed"("isActive");

-- CreateIndex
CREATE INDEX "AviatorRound_seedId_idx" ON "AviatorRound"("seedId");

-- AddForeignKey
ALTER TABLE "AviatorRound" ADD CONSTRAINT "AviatorRound_seedId_fkey" FOREIGN KEY ("seedId") REFERENCES "AviatorFairnessSeed"("id") ON DELETE SET NULL ON UPDATE CASCADE;
