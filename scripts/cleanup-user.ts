#!/usr/bin/env npx tsx
/**
 * Cleanup script: wipes all data for a user from the database and Upstash Redis cache.
 *
 * Usage:
 *   npx tsx scripts/cleanup-user.ts                    # interactive — prompts for userId
 *   npx tsx scripts/cleanup-user.ts <userId>           # wipe a specific user
 *   npx tsx scripts/cleanup-user.ts --all              # wipe ALL users (nuclear option)
 *   npx tsx scripts/cleanup-user.ts --cache-only       # flush only the Redis cache
 *
 * Requires .env.local (or env vars) with DATABASE_URL and optionally UPSTASH_REDIS_REST_URL/TOKEN.
 */

import "dotenv/config";
import * as readline from "node:readline";
import { PrismaPg } from "@prisma/adapter-pg";
import { Redis } from "@upstash/redis";
import { PrismaClient } from "../src/generated/prisma/client";

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("❌ DATABASE_URL or DIRECT_URL is required. Set it in .env.local");
  process.exit(1);
}
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

// ─── Redis ───────────────────────────────────────────────────────────────────

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

async function flushUserCache(userId: string, conversationIds: string[]) {
  const redis = getRedis();
  if (!redis) {
    console.log("  ⏭  No Redis configured — skipping cache flush");
    return;
  }

  const keys = [`convos:${userId}`, `github-owners:${userId}`, ...conversationIds.map((id) => `conv:${id}`)];

  // Also scan for any github-repos:* keys for this user
  let cursor = "0";
  do {
    const [nextCursor, found] = await redis.scan(cursor, {
      match: `github-repos:${userId}:*`,
      count: 100,
    });
    cursor = String(nextCursor);
    keys.push(...(found as string[]));
  } while (cursor !== "0");

  if (keys.length > 0) {
    await redis.del(...keys);
    console.log(`  🗑  Deleted ${keys.length} Redis keys`);
  } else {
    console.log("  ✓  No Redis keys found for this user");
  }
}

async function flushAllCache() {
  const redis = getRedis();
  if (!redis) {
    console.log("  ⏭  No Redis configured — skipping cache flush");
    return;
  }
  await redis.flushdb();
  console.log("  🗑  Flushed entire Redis database");
}

// ─── DB cleanup ──────────────────────────────────────────────────────────────

async function cleanupUser(userId: string) {
  // Gather conversation IDs first (for cache cleanup)
  const conversations = await prisma.conversation.findMany({
    where: { userId },
    select: { id: true },
  });
  const conversationIds = conversations.map((c) => c.id);

  // Count what we're about to delete
  const counts = await Promise.all([
    prisma.conversation.count({ where: { userId } }),
    prisma.agentRun.count({ where: { userId } }),
    prisma.repoBinding.count({ where: { userId } }),
    prisma.memoryEntry.count({ where: { userId } }),
    prisma.mcpConnector.count({ where: { userId } }),
    prisma.githubInstallation.count({ where: { userId } }),
  ]);

  console.log(`\n  📊 Data for user ${userId}:`);
  console.log(`     Conversations: ${counts[0]}`);
  console.log(`     Agent runs:    ${counts[1]}`);
  console.log(`     Repo bindings: ${counts[2]}`);
  console.log(`     Memory:        ${counts[3]}`);
  console.log(`     MCP connectors:${counts[4]}`);
  console.log(`     GitHub installs:${counts[5]}`);

  // Delete user profile — cascades to everything
  await prisma.userProfile.delete({ where: { userId } }).catch((err) => {
    if ((err as { code?: string }).code === "P2025") {
      console.log(`  ⚠  UserProfile not found — cleaning orphaned data`);
      // Fallback: delete by userId on each table directly
      return Promise.all([
        prisma.conversation.deleteMany({ where: { userId } }),
        prisma.repoBinding.deleteMany({ where: { userId } }),
        prisma.memoryEntry.deleteMany({ where: { userId } }),
        prisma.mcpConnector.deleteMany({ where: { userId } }),
        prisma.githubInstallation.deleteMany({ where: { userId } }),
        prisma.mainAgentSession.deleteMany({ where: { userId } }),
      ]);
    }
    throw err;
  });
  console.log(`  ✓  Deleted all DB records (cascade)`);

  // Flush cache
  await flushUserCache(userId, conversationIds);
}

async function cleanupAll() {
  const users = await prisma.userProfile.findMany({ select: { userId: true, email: true } });
  console.log(`\n  Found ${users.length} users:`);
  for (const u of users) {
    console.log(`    - ${u.userId} (${u.email})`);
  }

  // Delete all data in dependency order
  console.log("\n  Deleting all data...");
  await prisma.runEvent.deleteMany();
  await prisma.runApproval.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.agentRun.deleteMany();
  await prisma.codingSession.deleteMany();
  await prisma.mainAgentSession.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.repoSecret.deleteMany();
  await prisma.repoBinding.deleteMany();
  await prisma.memoryEntry.deleteMany();
  await prisma.mcpConnector.deleteMany();
  await prisma.githubInstallation.deleteMany();
  await prisma.userProfile.deleteMany();
  console.log("  ✓  All DB records deleted");

  await flushAllCache();
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--cache-only")) {
    console.log("\n🧹 Flushing Redis cache only...");
    await flushAllCache();
    console.log("\n✅ Done.\n");
    return;
  }

  if (args.includes("--all")) {
    const confirm = await prompt("\n⚠️  This will delete ALL users and ALL data. Type 'yes' to confirm: ");
    if (confirm !== "yes") {
      console.log("Aborted.");
      return;
    }
    console.log("\n🧹 Cleaning up all users...");
    await cleanupAll();
    console.log("\n✅ Done.\n");
    return;
  }

  let userId = args[0];
  if (!userId) {
    // List existing users for convenience
    const users = await prisma.userProfile.findMany({
      select: { userId: true, email: true },
      orderBy: { email: "asc" },
    });
    if (users.length > 0) {
      console.log("\n  Existing users:");
      for (const u of users) {
        console.log(`    ${u.userId}  ${u.email}`);
      }
    }
    userId = await prompt("\nEnter userId to clean up: ");
    if (!userId) {
      console.log("Aborted.");
      return;
    }
  }

  const confirm = await prompt(`\n⚠️  Delete all data for user "${userId}"? Type 'yes' to confirm: `);
  if (confirm !== "yes") {
    console.log("Aborted.");
    return;
  }

  console.log(`\n🧹 Cleaning up user: ${userId}`);
  await cleanupUser(userId);
  console.log("\n✅ Done.\n");
}

main()
  .catch((err) => {
    console.error("❌ Error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
