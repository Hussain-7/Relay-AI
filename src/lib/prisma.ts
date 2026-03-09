import { PrismaClient } from "@prisma/client";

declare global {
  var __relayAiPrisma__: PrismaClient | undefined;
}

export const prisma =
  globalThis.__relayAiPrisma__ ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__relayAiPrisma__ = prisma;
}
