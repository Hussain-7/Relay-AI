import { ConnectorAuthType, ConnectorType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveAuthContext } from "@/lib/auth-context";
import { encryptSecret } from "@/lib/crypto";
import { errorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const connectorSchema = z.object({
  userId: z.string().optional(),
  name: z.string().min(1),
  connectorType: z.enum(["rest", "graphql", "mcp"]),
  baseUrl: z.string().url().optional(),
  authType: z.enum(["none", "api_key", "bearer", "oauth2"]),
  config: z.record(z.any()).default({}),
  status: z.string().default("active"),
  secret: z.string().optional(),
});

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

export async function GET(request: NextRequest) {
  try {
    const auth = await resolveAuthContext(request);

    const connectors = await prisma.connectorConfig.findMany({
      where: { userId: auth.userId },
      include: {
        customTools: {
          select: {
            id: true,
            name: true,
            publishState: true,
            enabled: true,
            executionTarget: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ connectors });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = connectorSchema.parse(await request.json());
    const auth = await resolveAuthContext(request, body.userId);

    const connector = await prisma.connectorConfig.create({
      data: {
        userId: auth.userId,
        name: body.name,
        connectorType: mapConnectorType(body.connectorType),
        baseUrl: body.baseUrl,
        authType: mapAuthType(body.authType),
        configJson: body.config,
        status: body.status,
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

    return NextResponse.json({ connector }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
