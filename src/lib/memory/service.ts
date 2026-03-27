import { prisma } from "@/lib/prisma";

export async function searchMemoryEntries(input: {
  userId: string;
  conversationId: string;
  query: string;
  limit?: number;
}) {
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 10);
  const terms = input.query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  const entries = await prisma.memoryEntry.findMany({
    where: {
      userId: input.userId,
      OR: [{ conversationId: input.conversationId }, { conversationId: null }],
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  return entries
    .map((entry) => {
      const haystack = `${entry.key}\n${entry.value}`.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);

      return {
        id: entry.id,
        title: entry.key,
        content: entry.value,
        tags: entry.metadataJson,
        score,
      };
    })
    .filter((entry) => entry.score > 0 || terms.length === 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function writeMemoryEntry(input: {
  userId: string;
  conversationId: string;
  title: string;
  content: string;
  tags?: string[];
}) {
  return prisma.memoryEntry.create({
    data: {
      userId: input.userId,
      conversationId: input.conversationId,
      key: input.title,
      value: input.content,
      metadataJson: {
        tags: input.tags ?? [],
      },
    },
  });
}
