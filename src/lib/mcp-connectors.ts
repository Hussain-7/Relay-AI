import type { McpConnector } from "@/generated/prisma/client";

import { env } from "@/lib/env";
import { decryptToken, encryptToken } from "@/lib/mcp-token-crypto";
import { prisma } from "@/lib/prisma";

export interface OAuthMetadata {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
}

export interface TestConnectionResult {
  success: boolean;
  needsAuth: boolean;
  /** Server responded (even with an error status) — URL is reachable */
  reachable: boolean;
  error?: string;
  serverName?: string;
  authServerMetadata?: OAuthMetadata;
}

function inferTransport(url: string): "streamable-http" | "sse" | "unknown" {
  const path = new URL(url).pathname;
  if (path.endsWith("/mcp")) return "streamable-http";
  if (path.endsWith("/sse")) return "sse";
  return "unknown";
}

export async function testMcpConnection(
  url: string,
  authToken?: string,
): Promise<TestConnectionResult> {
  try {
    const transport = inferTransport(url);
    const headers: Record<string, string> = { "Content-Type": "application/json" };

    // Streamable HTTP expects Accept header for JSON + SSE responses
    if (transport === "streamable-http" || transport === "unknown") {
      headers["Accept"] = "application/json, text/event-stream";
    }

    if (authToken) {
      headers["Authorization"] = `Bearer ${authToken}`;
    }

    // SSE endpoints use GET to establish the event stream — just check reachability
    if (transport === "sse") {
      const response = await fetch(url, {
        method: "GET",
        headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) {
        await response.body?.cancel();
        return { success: true, needsAuth: false, reachable: true };
      }

      if (response.status === 401) {
        const metadata = await discoverOAuthMetadata(url);
        return { success: false, needsAuth: true, reachable: true, authServerMetadata: metadata ?? undefined };
      }

      return { success: false, needsAuth: false, reachable: true, error: `Server returned ${response.status}` };
    }

    // Streamable HTTP / unknown — POST JSON-RPC initialize
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "relay-ai", version: "1.0" },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (response.ok) {
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("text/event-stream")) {
        await response.body?.cancel();
        return { success: true, needsAuth: false, reachable: true };
      }
      const body = await response.json() as { result?: { serverInfo?: { name?: string } } };
      return {
        success: true,
        needsAuth: false,
        reachable: true,
        serverName: body.result?.serverInfo?.name,
      };
    }

    if (response.status === 401) {
      const metadata = await discoverOAuthMetadata(url);
      return { success: false, needsAuth: true, reachable: true, authServerMetadata: metadata ?? undefined };
    }

    // 404/410 → URL doesn't point to a valid MCP endpoint
    if (response.status === 404 || response.status === 410) {
      return { success: false, needsAuth: false, reachable: false, error: "No MCP server found at this URL" };
    }

    // Other HTTP errors (405, 406, 500, etc.) — server is reachable, may be a transport mismatch
    return {
      success: false,
      needsAuth: false,
      reachable: true,
      error: `Server returned ${response.status}`,
    };
  } catch (err) {
    // Network-level failure: DNS, timeout, connection refused
    const message = err instanceof Error ? err.message : "Connection failed";
    return { success: false, needsAuth: false, reachable: false, error: message };
  }
}

export async function discoverOAuthMetadata(mcpUrl: string): Promise<OAuthMetadata | null> {
  try {
    const parsed = new URL(mcpUrl);
    const baseUrl = `${parsed.protocol}//${parsed.host}`;

    const wellKnownUrl = `${baseUrl}/.well-known/oauth-authorization-server`;
    const response = await fetch(wellKnownUrl, { signal: AbortSignal.timeout(5_000) });

    if (response.ok) {
      const metadata = await response.json() as OAuthMetadata;
      if (metadata.authorization_endpoint && metadata.token_endpoint) {
        return metadata;
      }
    }

    // Fallback endpoints per MCP spec
    return {
      authorization_endpoint: `${baseUrl}/authorize`,
      token_endpoint: `${baseUrl}/token`,
      registration_endpoint: `${baseUrl}/register`,
    };
  } catch {
    return null;
  }
}

export async function registerOAuthClient(
  registrationEndpoint: string,
  redirectUri: string,
): Promise<{ clientId: string; clientSecret?: string } | null> {
  try {
    const response = await fetch(registrationEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Relay AI",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) return null;

    const body = await response.json() as {
      client_id: string;
      client_secret?: string;
    };

    return {
      clientId: body.client_id,
      clientSecret: body.client_secret,
    };
  } catch {
    return null;
  }
}

export async function exchangeCodeForTokens(
  tokenEndpoint: string,
  code: string,
  redirectUri: string,
  codeVerifier: string,
  clientId: string,
  clientSecret?: string,
): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
} | null> {
  try {
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      client_id: clientId,
    });
    if (clientSecret) {
      params.set("client_secret", clientSecret);
    }

    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) return null;

    const body = await response.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresIn: body.expires_in,
    };
  } catch {
    return null;
  }
}

export async function refreshMcpToken(
  connector: McpConnector,
): Promise<{ accessToken: string; expiresAt: Date } | null> {
  if (!connector.encryptedRefreshToken || !connector.refreshTokenIv) {
    return null;
  }

  const metadata = connector.oauthServerMetadata as OAuthMetadata | null;
  if (!metadata?.token_endpoint || !connector.oauthClientId) {
    return null;
  }

  try {
    const refreshToken = decryptToken(connector.encryptedRefreshToken, connector.refreshTokenIv);
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: connector.oauthClientId,
    });
    if (connector.oauthClientSecret) {
      params.set("client_secret", connector.oauthClientSecret);
    }

    const response = await fetch(metadata.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      await prisma.mcpConnector.update({
        where: { id: connector.id },
        data: { status: "NEEDS_AUTH", lastError: "Token refresh failed" },
      });
      return null;
    }

    const body = await response.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    const expiresAt = new Date(Date.now() + (body.expires_in ?? 3600) * 1000);
    const encAccess = encryptToken(body.access_token);

    const updateData: Record<string, unknown> = {
      encryptedAccessToken: encAccess.encrypted,
      accessTokenIv: encAccess.iv,
      tokenExpiresAt: expiresAt,
      status: "ACTIVE",
      lastError: null,
    };

    if (body.refresh_token) {
      const encRefresh = encryptToken(body.refresh_token);
      updateData.encryptedRefreshToken = encRefresh.encrypted;
      updateData.refreshTokenIv = encRefresh.iv;
    }

    await prisma.mcpConnector.update({
      where: { id: connector.id },
      data: updateData,
    });

    return { accessToken: body.access_token, expiresAt };
  } catch {
    await prisma.mcpConnector.update({
      where: { id: connector.id },
      data: { status: "NEEDS_AUTH", lastError: "Token refresh error" },
    }).catch(() => {});
    return null;
  }
}

export function getOAuthCallbackUrl(request?: Request) {
  const baseUrl = request ? new URL(request.url).origin : env.APP_URL;
  return `${baseUrl}/api/mcp-connectors/callback`;
}
