import type { MCPServer } from "@prisma/client";

export interface McpRecommendation {
  id: string;
  reason: string;
  score: number;
}

function normalize(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
}

function tokenize(input: string): string[] {
  return normalize(input)
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

export function recommendMcpServers(
  query: string,
  servers: MCPServer[],
): McpRecommendation[] {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) {
    return [];
  }

  const recommendations: McpRecommendation[] = [];

  for (const server of servers) {
    const configText = JSON.stringify(server.configJson ?? {}).toLowerCase();
    const serverText = `${server.id} ${server.status} ${configText}`;
    const serverTokens = tokenize(serverText);

    let score = 0;
    for (const token of serverTokens) {
      if (queryTokens.has(token)) {
        score += 1;
      }
    }

    if (score > 0) {
      recommendations.push({
        id: server.id,
        reason: `Matched ${score} query tokens against server configuration`,
        score,
      });
    }
  }

  return recommendations.sort((a, b) => b.score - a.score).slice(0, 4);
}
