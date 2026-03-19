import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

declare global {
  var __relayAiPrisma__: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  // Use DIRECT_URL (bypasses PgBouncer) for the pg Pool —
  // Prisma's prepared statements require a direct connection.
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  const pool = new pg.Pool({ connectionString });
  const adapter = new PrismaPg(pool);

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
