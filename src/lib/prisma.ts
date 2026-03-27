import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { PrismaClient } from "@/generated/prisma/client";

declare global {
  var __relayAiPrisma__: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  // Runtime uses DATABASE_URL (pooler via PgBouncer, port 6543) for connection reuse.
  // DIRECT_URL (port 5432, no pooler) is only for prisma db push / migrations.
  const connectionString = process.env.DATABASE_URL;
  const isProduction = process.env.NODE_ENV === "production";

  // Create an explicit pg.Pool — prevents the "client.query() while already
  // executing" deprecation warning by ensuring proper connection checkout.
  const pool = new pg.Pool({
    connectionString,
    max: isProduction ? 5 : 10,
    // Release idle clients back to the pool quickly on serverless
    idleTimeoutMillis: 30_000,
    // Don't wait forever for a connection
    connectionTimeoutMillis: 10_000,
  });

  const adapter = new PrismaPg(pool);

  return new PrismaClient({
    adapter,
    log: isProduction ? ["error"] : ["error", "warn"],
  });
}

// Cache the client globally — prevents creating new pools on every import in
// both development (hot reload) AND production (serverless warm starts).
export const prisma = globalThis.__relayAiPrisma__ ?? createPrismaClient();

globalThis.__relayAiPrisma__ = prisma;
