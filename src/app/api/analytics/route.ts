import { prisma } from "@/lib/prisma";
import { requireRequestUser } from "@/lib/server-auth";

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request.headers);
    const userId = user.userId;

    const url = new URL(request.url);
    const days = Math.min(Number(url.searchParams.get("days") ?? 30), 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Run all queries in parallel
    const [totals, conversationCount, messageCount, dailyRuns, modelBreakdown, topConversations] = await Promise.all([
      // Aggregate totals
      prisma.agentRun.aggregate({
        where: { userId, createdAt: { gte: since } },
        _sum: {
          costUsd: true,
          inputTokens: true,
          outputTokens: true,
          cacheReadTokens: true,
          cacheWriteTokens: true,
        },
        _count: { id: true },
      }),

      // Total conversations
      prisma.conversation.count({ where: { userId } }),

      // Total messages in period
      prisma.message.count({
        where: { conversation: { userId }, createdAt: { gte: since } },
      }),

      // Daily run counts + cost (for time-series chart)
      prisma.$queryRawUnsafe<Array<{ day: string; runs: bigint; cost: number; tokens: bigint }>>(
        `SELECT
           DATE("createdAt") as day,
           COUNT(*)::bigint as runs,
           COALESCE(SUM("costUsd"), 0) as cost,
           COALESCE(SUM("inputTokens") + SUM("outputTokens"), 0)::bigint as tokens
         FROM "AgentRun"
         WHERE "userId" = $1 AND "createdAt" >= $2
         GROUP BY DATE("createdAt")
         ORDER BY day ASC`,
        userId,
        since,
      ),

      // Cost by model
      prisma.agentRun.groupBy({
        by: ["model"],
        where: { userId, createdAt: { gte: since }, model: { not: null } },
        _sum: { costUsd: true, inputTokens: true, outputTokens: true },
        _count: { id: true },
        orderBy: { _sum: { costUsd: "desc" } },
      }),

      // Top conversations by cost (only runs with actual cost data)
      prisma.agentRun.groupBy({
        by: ["conversationId"],
        where: { userId, createdAt: { gte: since }, costUsd: { not: null, gt: 0 } },
        _sum: { costUsd: true },
        _count: { id: true },
        orderBy: { _sum: { costUsd: "desc" } },
        take: 5,
      }),
    ]);

    // Fetch conversation titles for top conversations
    const topConvoIds = topConversations.map((c) => c.conversationId);
    const conversations =
      topConvoIds.length > 0
        ? await prisma.conversation.findMany({
            where: { id: { in: topConvoIds } },
            select: { id: true, title: true },
          })
        : [];
    const titleMap = new Map(conversations.map((c) => [c.id, c.title]));

    return Response.json({
      period: { days, since: since.toISOString() },
      totals: {
        runs: totals._count.id,
        conversations: conversationCount,
        messages: messageCount,
        costUsd: totals._sum.costUsd ?? 0,
        inputTokens: totals._sum.inputTokens ?? 0,
        outputTokens: totals._sum.outputTokens ?? 0,
        cacheReadTokens: totals._sum.cacheReadTokens ?? 0,
        cacheWriteTokens: totals._sum.cacheWriteTokens ?? 0,
        totalTokens:
          (totals._sum.inputTokens ?? 0) +
          (totals._sum.outputTokens ?? 0) +
          (totals._sum.cacheReadTokens ?? 0) +
          (totals._sum.cacheWriteTokens ?? 0),
      },
      daily: dailyRuns.map((d) => ({
        day: d.day,
        runs: Number(d.runs),
        cost: Number(d.cost),
        tokens: Number(d.tokens),
      })),
      models: modelBreakdown.map((m) => ({
        model: m.model,
        runs: m._count.id,
        costUsd: m._sum.costUsd ?? 0,
        inputTokens: m._sum.inputTokens ?? 0,
        outputTokens: m._sum.outputTokens ?? 0,
      })),
      topConversations: topConversations.map((c) => ({
        conversationId: c.conversationId,
        title: titleMap.get(c.conversationId) ?? "Untitled",
        runs: c._count.id,
        costUsd: c._sum.costUsd ?? 0,
      })),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to fetch analytics." },
      { status: 400 },
    );
  }
}
