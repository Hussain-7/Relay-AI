import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

declare global {
  var __relayAiPrisma__: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  // Runtime uses DATABASE_URL (pooler via PgBouncer, port 6543) for connection reuse.
  // DIRECT_URL (port 5432, no pooler) is only for prisma db push / migrations.
  const connectionString = process.env.DATABASE_URL;
  const isProduction = process.env.NODE_ENV === "production";

  const adapter = new PrismaPg({
    connectionString,
    // Limit pool size — on Vercel serverless, each function gets its own pool.
    // Keep small to avoid exhausting Supabase's 100-connection limit.
    max: isProduction ? 3 : 10,
  });

  return new PrismaClient({
    adapter,
    log: isProduction ? ["error"] : ["error", "warn"],
  });
}

// Cache the client globally — prevents creating new pools on every import in
// both development (hot reload) AND production (serverless warm starts).
export const prisma =
  globalThis.__relayAiPrisma__ ?? createPrismaClient();

globalThis.__relayAiPrisma__ = prisma;
