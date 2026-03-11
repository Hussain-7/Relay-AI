import { randomBytes, createHash } from "crypto";

import { cookies } from "next/headers";

import { env } from "@/lib/env";
import type { OAuthMetadata } from "@/lib/mcp-connectors";
import { getOAuthCallbackUrl, registerOAuthClient } from "@/lib/mcp-connectors";
import { prisma } from "@/lib/prisma";
import { requireRequestUser } from "@/lib/server-auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!env.MCP_TOKEN_SECRET) {
    return Response.json({ error: "MCP_TOKEN_SECRET is not configured" }, { status: 500 });
  }

  const user = await requireRequestUser(request.headers);
  const { id } = await params;

  const connector = await prisma.mcpConnector.findUnique({ where: { id } });
  if (!connector || connector.userId !== user.userId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const metadata = connector.oauthServerMetadata as OAuthMetadata | null;
  if (!metadata?.authorization_endpoint) {
    return Response.json({ error: "No OAuth metadata found" }, { status: 400 });
  }

  // Dynamic client registration if we don't have a client_id yet
  let clientId = connector.oauthClientId;
  let clientSecret = connector.oauthClientSecret;

  if (!clientId && metadata.registration_endpoint) {
    const redirectUri = getOAuthCallbackUrl();
    const reg = await registerOAuthClient(metadata.registration_endpoint, redirectUri);
    if (reg) {
      clientId = reg.clientId;
      clientSecret = reg.clientSecret ?? null;
      await prisma.mcpConnector.update({
        where: { id },
        data: { oauthClientId: clientId, oauthClientSecret: clientSecret },
      });
    }
  }

  if (!clientId) {
    return Response.json({ error: "Could not register OAuth client" }, { status: 422 });
  }

  // PKCE
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

  // State contains connector ID for the callback
  const state = Buffer.from(JSON.stringify({ connectorId: id })).toString("base64url");

  // Store code_verifier in a short-lived cookie
  const jar = await cookies();
  jar.set(`mcp_pkce_${id}`, codeVerifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/mcp-connectors/callback",
    maxAge: 600, // 10 minutes
  });

  const authUrl = new URL(metadata.authorization_endpoint);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", getOAuthCallbackUrl());
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);

  return Response.redirect(authUrl.toString());
}
