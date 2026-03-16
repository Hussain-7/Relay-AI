import { getRedis } from "@/lib/redis";

// In-memory fallback when Redis is unavailable
const memoryFlags = new Map<string, boolean>();

function redisKey(runId: string) {
  return `run:${runId}:stop`;
}

export async function setStopFlag(runId: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    await redis.set(redisKey(runId), "1", { ex: 60 });
  } else {
    memoryFlags.set(runId, true);
  }
}

export async function checkStopFlag(runId: string): Promise<boolean> {
  console.log("checkStopFlag:", runId);
  const redis = getRedis();
  if (redis) {
    const val = await redis.get(redisKey(runId));
    // Upstash auto-deserializes JSON, so "1" comes back as number 1
    return val != null;
  }
  return memoryFlags.get(runId) === true;
}

export async function clearStopFlag(runId: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    await redis.del(redisKey(runId));
  }
  memoryFlags.delete(runId);
}
