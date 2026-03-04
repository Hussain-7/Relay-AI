import { ConnectorAuthType, ConnectorType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveAuthContext } from "@/lib/auth-context";
import { encryptSecret } from "@/lib/crypto";
import { errorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const patchConnectorSchema = z.object({
  userId: z.string().optional(),
  name: z.string().min(1).optional(),
  connectorType: z.enum(["rest", "graphql", "mcp"]).optional(),
  baseUrl: z.string().url().nullable().optional(),
  authType: z.enum(["none", "api_key", "bearer", "oauth2"]).optional(),
  config: z.record(z.any()).optional(),
  status: z.string().optional(),
  secret: z.string().min(1).optional(),
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

function mapConnectorType(value: "rest" | "graphql" | "mcp"): ConnectorType {
  return value === "rest"
    ? ConnectorType.REST
    : value === "graphql"
      ? ConnectorType.GRAPHQL
      : ConnectorType.MCP;
}

function mapAuthType(
  value: "none" | "api_key" | "bearer" | "oauth2",
): ConnectorAuthType {
  if (value === "api_key") return ConnectorAuthType.API_KEY;
  if (value === "bearer") return ConnectorAuthType.BEARER;
  if (value === "oauth2") return ConnectorAuthType.OAUTH2;
  return ConnectorAuthType.NONE;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const body = patchConnectorSchema.parse(await request.json());
    const auth = await resolveAuthContext(request, body.userId);
    const { id } = await context.params;

    const existing = await prisma.connectorConfig.findFirst({
      where: {
        id,
        userId: auth.userId,
      },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Connector not found" },
        { status: 404 },
      );
    }

    const connector = await prisma.connectorConfig.update({
      where: { id: existing.id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.connectorType
          ? { connectorType: mapConnectorType(body.connectorType) }
          : {}),
        ...(body.baseUrl !== undefined ? { baseUrl: body.baseUrl } : {}),
        ...(body.authType ? { authType: mapAuthType(body.authType) } : {}),
        ...(body.config ? { configJson: body.config } : {}),
        ...(body.status ? { status: body.status } : {}),
      },
    });

    if (body.secret) {
      const encrypted = encryptSecret(body.secret);
      await prisma.connectorSecret.create({
        data: {
          connectorId: connector.id,
          encryptedSecretBlob: JSON.stringify(encrypted),
          keyVersion: encrypted.keyVersion,
          lastValidatedAt: new Date(),
        },
      });
    }

    return NextResponse.json({ connector });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const auth = await resolveAuthContext(request);
    const { id } = await context.params;

    const existing = await prisma.connectorConfig.findFirst({
      where: {
        id,
        userId: auth.userId,
      },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Connector not found" },
        { status: 404 },
      );
    }

    await prisma.connectorConfig.delete({
      where: { id: existing.id },
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
