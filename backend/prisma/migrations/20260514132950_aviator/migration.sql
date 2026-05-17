-- CreateEnum
CREATE TYPE "AviatorRoundStatus" AS ENUM ('BETTING', 'RUNNING', 'CRASHED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "demoBalance" INTEGER NOT NULL DEFAULT 1000;

-- CreateTable
CREATE TABLE "AviatorRound" (
    "id" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "serverSeed" TEXT NOT NULL,
    "serverSeedHash" TEXT NOT NULL,
    "clientSeed" TEXT NOT NULL,
    "crashMultiplier" DECIMAL(10,2) NOT NULL,
    "status" "AviatorRoundStatus" NOT NULL DEFAULT 'BETTING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "crashedAt" TIMESTAMP(3),

    CONSTRAINT "AviatorRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AviatorBet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "autoCashoutAt" DECIMAL(10,2),
    "cashedOutAt" TIMESTAMP(3),
    "cashedOutMultiplier" DECIMAL(10,2),
    "payout" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AviatorBet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AviatorChatMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "message" VARCHAR(280) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AviatorChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AviatorRound_roundNumber_key" ON "AviatorRound"("roundNumber");

-- CreateIndex
CREATE INDEX "AviatorRound_status_idx" ON "AviatorRound"("status");

-- CreateIndex
CREATE INDEX "AviatorRound_startedAt_idx" ON "AviatorRound"("startedAt" DESC);

-- CreateIndex
CREATE INDEX "AviatorBet_roundId_idx" ON "AviatorBet"("roundId");

-- CreateIndex
CREATE INDEX "AviatorBet_userId_createdAt_idx" ON "AviatorBet"("userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "AviatorBet_userId_roundId_key" ON "AviatorBet"("userId", "roundId");

-- CreateIndex
CREATE INDEX "AviatorChatMessage_createdAt_idx" ON "AviatorChatMessage"("createdAt" DESC);

-- AddForeignKey
ALTER TABLE "AviatorBet" ADD CONSTRAINT "AviatorBet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AviatorBet" ADD CONSTRAINT "AviatorBet_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "AviatorRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AviatorChatMessage" ADD CONSTRAINT "AviatorChatMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
