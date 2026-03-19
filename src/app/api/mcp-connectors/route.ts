import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";

import { env } from "@/lib/env";
import { testMcpConnection, getOAuthCallbackUrl, registerOAuthClient } from "@/lib/mcp-connectors";
import { encryptToken } from "@/lib/mcp-token-crypto";
import { prisma } from "@/lib/prisma";
import { requireRequestUser } from "@/lib/server-auth";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  authorizationToken: z.string().optional(),
  clientId: z.string().optional(),
});

export async function GET(request: Request) {
  const user = await requireRequestUser(request.headers);

  const connectors = await prisma.mcpConnector.findMany({
    where: { userId: user.userId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      url: true,
      encryptedAccessToken: true,
      status: true,
      lastError: true,
      createdAt: true,
    },
  });

  return Response.json({
    connectors: connectors.map((c) => ({
      id: c.id,
      name: c.name,
      url: c.url,
      hasToken: Boolean(c.encryptedAccessToken),
      status: c.status,
      lastError: c.lastError,
      createdAt: c.createdAt.toISOString(),
    })),
  });
}

export async function POST(request: Request) {
  const user = await requireRequestUser(request.headers);
  const body = createSchema.parse(await request.json());

  // Check for duplicate URL
  const existing = await prisma.mcpConnector.findUnique({
    where: { userId_url: { userId: user.userId, url: body.url } },
  });
  if (existing) {
    return Response.json({ error: "This MCP server is already connected" }, { status: 409 });
  }

  // Test the connection
  const result = await testMcpConnection(body.url, body.authorizationToken);

  if (result.success) {
    // Open server — save as ACTIVE
    let tokenData: { encryptedAccessToken: string; accessTokenIv: string } | undefined;
    if (body.authorizationToken && env.MCP_TOKEN_SECRET) {
      const enc = encryptToken(body.authorizationToken);
      tokenData = { encryptedAccessToken: enc.encrypted, accessTokenIv: enc.iv };
    }

    const connector = await prisma.mcpConnector.create({
      data: {
        userId: user.userId,
        name: body.name,
        url: body.url,
        status: "ACTIVE",
        ...tokenData,
      },
    });

    return Response.json({
      connector: {
        id: connector.id,
        name: connector.name,
        url: connector.url,
        hasToken: Boolean(tokenData),
        status: connector.status,
        lastError: null,
        createdAt: connector.createdAt.toISOString(),
      },
    });
  }

  if (result.needsAuth && result.authServerMetadata) {
    // OAuth-protected server — save with NEEDS_AUTH + metadata
    const redirectUri = getOAuthCallbackUrl(request);

    // Try dynamic client registration
    let clientId: string | undefined;
    let clientSecret: string | undefined;
    if (result.authServerMetadata.registration_endpoint) {
      const reg = await registerOAuthClient(result.authServerMetadata.registration_endpoint, redirectUri);
      if (reg) {
        clientId = reg.clientId;
        clientSecret = reg.clientSecret;
      }
    }

    const connector = await prisma.mcpConnector.create({
      data: {
        userId: user.userId,
        name: body.name,
        url: body.url,
        status: "NEEDS_AUTH",
        oauthServerMetadata: result.authServerMetadata as unknown as Prisma.InputJsonValue,
        oauthClientId: clientId ?? body.clientId,
        oauthClientSecret: clientSecret,
      },
    });

    return Response.json({
      connector: {
        id: connector.id,
        name: connector.name,
        url: connector.url,
        hasToken: false,
        status: "NEEDS_AUTH",
        lastError: null,
        createdAt: connector.createdAt.toISOString(),
      },
      needsAuth: true,
    });
  }

  // Server is unreachable (DNS failure, timeout, 404) — reject
  if (!result.reachable) {
    return Response.json(
      { error: result.error ?? "Could not reach MCP server" },
      { status: 422 },
    );
  }

  // Server is reachable but returned a non-success status (405, 406, 500, etc.)
  // This can be a transport mismatch — save with a warning since Anthropic connects directly
  let tokenData: { encryptedAccessToken: string; accessTokenIv: string } | undefined;
  if (body.authorizationToken && env.MCP_TOKEN_SECRET) {
    const enc = encryptToken(body.authorizationToken);
    tokenData = { encryptedAccessToken: enc.encrypted, accessTokenIv: enc.iv };
  }

  const connector = await prisma.mcpConnector.create({
    data: {
      userId: user.userId,
      name: body.name,
      url: body.url,
      status: "ACTIVE",
      lastError: result.error ?? null,
      ...tokenData,
    },
  });

  return Response.json({
    connector: {
      id: connector.id,
      name: connector.name,
      url: connector.url,
      hasToken: Boolean(tokenData),
      status: connector.status,
      lastError: connector.lastError,
      createdAt: connector.createdAt.toISOString(),
    },
    warning: result.error,
  });
}
