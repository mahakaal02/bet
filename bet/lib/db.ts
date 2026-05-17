import { PrismaClient } from "@prisma/client";

// Reuse the same client across hot-reloads in dev. Without this Next would
// open a new Postgres connection on every save and quickly exhaust the
// connection limit.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
