import { cookies } from "next/headers";

import { env } from "@/lib/env";
import type { OAuthMetadata } from "@/lib/mcp-connectors";
import { exchangeCodeForTokens, getOAuthCallbackUrl } from "@/lib/mcp-connectors";
import { encryptToken } from "@/lib/mcp-token-crypto";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return redirectWithMessage(`OAuth error: ${error}`);
  }

  if (!code || !stateParam) {
    return redirectWithMessage("Missing code or state");
  }

  let connectorId: string;
  try {
    const parsed = JSON.parse(Buffer.from(stateParam, "base64url").toString()) as { connectorId: string };
    connectorId = parsed.connectorId;
  } catch {
    return redirectWithMessage("Invalid state parameter");
  }

  const connector = await prisma.mcpConnector.findUnique({ where: { id: connectorId } });
  if (!connector) {
    return redirectWithMessage("Connector not found");
  }

  // Retrieve PKCE code_verifier from cookie
  const jar = await cookies();
  const codeVerifier = jar.get(`mcp_pkce_${connectorId}`)?.value;
  if (!codeVerifier) {
    return redirectWithMessage("PKCE verifier expired — please try again");
  }

  // Clean up the cookie
  jar.delete(`mcp_pkce_${connectorId}`);

  const metadata = connector.oauthServerMetadata as OAuthMetadata | null;
  if (!metadata?.token_endpoint || !connector.oauthClientId) {
    return redirectWithMessage("Missing OAuth configuration");
  }

  const tokens = await exchangeCodeForTokens(
    metadata.token_endpoint,
    code,
    getOAuthCallbackUrl(),
    codeVerifier,
    connector.oauthClientId,
    connector.oauthClientSecret ?? undefined,
  );

  if (!tokens) {
    return redirectWithMessage("Token exchange failed");
  }

  if (!env.MCP_TOKEN_SECRET) {
    return redirectWithMessage("MCP_TOKEN_SECRET is not configured — cannot store tokens");
  }

  // Encrypt and store tokens
  const encAccess = encryptToken(tokens.accessToken);
  const updateData: Record<string, unknown> = {
    status: "ACTIVE",
    lastError: null,
    encryptedAccessToken: encAccess.encrypted,
    accessTokenIv: encAccess.iv,
  };

  if (tokens.refreshToken) {
    const encRefresh = encryptToken(tokens.refreshToken);
    updateData.encryptedRefreshToken = encRefresh.encrypted;
    updateData.refreshTokenIv = encRefresh.iv;
  }

  if (tokens.expiresIn) {
    updateData.tokenExpiresAt = new Date(Date.now() + tokens.expiresIn * 1000);
  }

  await prisma.mcpConnector.update({
    where: { id: connectorId },
    data: updateData,
  });

  // Return HTML that closes the popup and notifies the opener
  return new Response(
    `<!DOCTYPE html>
<html><head><title>Connected</title></head>
<body>
<script>
  if (window.opener) {
    window.opener.postMessage({ type: "mcp-connector-linked", connectorId: "${connectorId}" }, "*");
    window.close();
  } else {
    window.location.href = "/chat/new";
  }
</script>
<p>Connection successful. You can close this window.</p>
</body></html>`,
    { headers: { "Content-Type": "text/html" } },
  );
}

function redirectWithMessage(message: string) {
  const safeMessage = message.replace(/"/g, '\\"').replace(/</g, "&lt;");
  return new Response(
    `<!DOCTYPE html>
<html><head><title>Error</title></head>
<body>
<script>
  if (window.opener) {
    window.opener.postMessage({ type: "mcp-connector-error", error: "${safeMessage}" }, "*");
    window.close();
  } else {
    window.location.href = "/chat/new";
  }
</script>
<p>${safeMessage}</p>
</body></html>`,
    { headers: { "Content-Type": "text/html" } },
  );
}
