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
const TOKEN_REFRESH_TIMEOUT_MS = 3000; // max 3s for token refresh

/**
 * Load MCP servers for a user. If connectorIds is provided, load those specific connectors
 * (used by scheduled prompts to use the snapshot of connectors at schedule time).
 * Otherwise, load all ACTIVE connectors.
 */
export async function getConfiguredMcpServers(userId: string, connectorIds?: string[]): Promise<ConfiguredMcpServer[]> {
  const connectors = await prisma.mcpConnector.findMany({
    where: connectorIds?.length ? { userId, id: { in: connectorIds } } : { userId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });

  // Process all connectors in parallel — each one resolves independently
  const results = await Promise.allSettled(
    connectors.map(async (connector): Promise<ConfiguredMcpServer | null> => {
      let authToken: string | null = null;

      if (connector.encryptedAccessToken && connector.accessTokenIv) {
        // Check if token is expired or near-expiry
        const isExpired =
          connector.tokenExpiresAt && connector.tokenExpiresAt.getTime() < Date.now() + TOKEN_EXPIRY_BUFFER_MS;

        if (isExpired && connector.encryptedRefreshToken) {
          // Race token refresh against a timeout so one slow OAuth server doesn't block the run
          const refreshed = await Promise.race([
            refreshMcpToken(connector),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), TOKEN_REFRESH_TIMEOUT_MS)),
          ]);
          if (refreshed) {
            authToken = refreshed.accessToken;
          } else {
            console.warn(`MCP connector "${connector.name}": token refresh timed out or failed, skipping`);
            return null;
          }
        } else {
          try {
            if (env.MCP_TOKEN_SECRET) {
              authToken = decryptToken(connector.encryptedAccessToken, connector.accessTokenIv);
            }
          } catch {
            console.warn(`MCP connector "${connector.name}": token decryption failed, skipping`);
            return null;
          }
        }
      }

      return {
        name: connector.name,
        type: "url",
        url: connector.url,
        authorization_token: authToken,
      };
    }),
  );

  return results
    .filter((r): r is PromiseFulfilledResult<ConfiguredMcpServer | null> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((s): s is ConfiguredMcpServer => s !== null);
}
