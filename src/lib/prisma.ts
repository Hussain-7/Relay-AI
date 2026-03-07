import { PrismaClient } from "@prisma/client";

declare global {
  var __endlessDevPrisma__: PrismaClient | undefined;
}

export const prisma =
  globalThis.__endlessDevPrisma__ ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__endlessDevPrisma__ = prisma;
}
