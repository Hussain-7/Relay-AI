import { env } from "@/lib/env";
import { refreshMcpToken } from "@/lib/mcp-connectors";
import { decryptToken } from "@/lib/mcp-token-crypto";
import { prisma } from "@/lib/prisma";

export interface ConfiguredMcpServer {
  name: string;
  type: "url";
  url: string;
  authorization_token?: string | null;
  tool_configuration?: {
    allowed_tools?: string[] | null;
    enabled?: boolean | null;
  } | null;
}

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

export async function getConfiguredMcpServers(userId: string): Promise<ConfiguredMcpServer[]> {
  const connectors = await prisma.mcpConnector.findMany({
    where: { userId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });

  const servers: ConfiguredMcpServer[] = [];

  for (const connector of connectors) {
    let authToken: string | null = null;

    if (connector.encryptedAccessToken && connector.accessTokenIv) {
      // Check if token is expired or near-expiry
      const isExpired = connector.tokenExpiresAt &&
        connector.tokenExpiresAt.getTime() < Date.now() + TOKEN_EXPIRY_BUFFER_MS;

      if (isExpired && connector.encryptedRefreshToken) {
        const refreshed = await refreshMcpToken(connector);
        if (refreshed) {
          authToken = refreshed.accessToken;
        } else {
          // Refresh failed — skip this connector
          continue;
        }
      } else {
        try {
          if (env.MCP_TOKEN_SECRET) {
            authToken = decryptToken(connector.encryptedAccessToken, connector.accessTokenIv);
          }
        } catch {
          // Decryption failed — skip
          continue;
        }
      }
    }

    servers.push({
      name: connector.name,
      type: "url",
      url: connector.url,
      authorization_token: authToken,
    });
  }

  return servers;
}
