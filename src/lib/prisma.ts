import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

declare global {
  var __relayAiPrisma__: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  // Use DIRECT_URL (bypasses PgBouncer) — Prisma needs direct connections
  // for prepared statements. Pass PoolConfig so PrismaPg manages the pool.
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  const adapter = new PrismaPg({ connectionString });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const prisma =
  globalThis.__relayAiPrisma__ ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__relayAiPrisma__ = prisma;
}
