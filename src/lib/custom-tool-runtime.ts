import crypto from "node:crypto";
import {
  ConnectorAuthType,
  ConnectorType,
  ExecutionTarget,
  ToolPublishState,
} from "@prisma/client";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { decryptSecret, type EncryptedSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { appendRunEvent } from "@/lib/run-events";
import { ensureToolApprovedOrRequest } from "@/lib/tool-approvals";

function parseEncryptedSecret(blob: string): string {
  const parsed = JSON.parse(blob) as EncryptedSecret;
  return decryptSecret(parsed);
}

function sanitizeToolName(name: string, fallbackId: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!normalized) {
    return `custom_${fallbackId}`;
  }

  if (/^[0-9]/.test(normalized)) {
    return `tool_${normalized}`;
  }

  return normalized;
}

async function resolveConnectorSecret(
  connectorId: string,
): Promise<string | null> {
  const latest = await prisma.connectorSecret.findFirst({
    where: { connectorId },
    orderBy: { createdAt: "desc" },
  });

  if (!latest) {
    return null;
  }

  return parseEncryptedSecret(latest.encryptedSecretBlob);
}

function applyConnectorAuth(
  headers: Headers,
  authType: ConnectorAuthType,
  secret: string | null,
  config: Record<string, unknown>,
) {
  if (!secret || authType === ConnectorAuthType.NONE) {
    return;
  }

  if (authType === ConnectorAuthType.API_KEY) {
    const headerName =
      typeof config.apiKeyHeader === "string"
        ? config.apiKeyHeader
        : "x-api-key";
    headers.set(headerName, secret);
    return;
  }

  if (
    authType === ConnectorAuthType.BEARER ||
    authType === ConnectorAuthType.OAUTH2
  ) {
    headers.set("authorization", `Bearer ${secret}`);
  }
}

async function invokeRestOrGraphqlTool(params: {
  baseUrl: string;
  method: string;
  config: Record<string, unknown>;
  authType: ConnectorAuthType;
  connectorId: string;
  input: Record<string, unknown>;
}) {
  const secret = await resolveConnectorSecret(params.connectorId);

  const headers = new Headers();
  headers.set("content-type", "application/json");
  applyConnectorAuth(headers, params.authType, secret, params.config);

  const requestInit: RequestInit = {
    method: params.method,
    headers,
  };

  let url = params.baseUrl;

  if (params.method === "GET") {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params.input)) {
      searchParams.set(key, String(value));
    }
    const suffix = searchParams.toString();
    if (suffix) {
      url = `${params.baseUrl}${params.baseUrl.includes("?") ? "&" : "?"}${suffix}`;
    }
  } else {
    requestInit.body = JSON.stringify(params.input);
  }

  const response = await fetch(url, requestInit);
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

async function invokeMcpConnectorTool(params: {
  baseUrl: string;
  config: Record<string, unknown>;
  authType: ConnectorAuthType;
  connectorId: string;
  toolName: string;
  input: Record<string, unknown>;
}) {
  const secret = await resolveConnectorSecret(params.connectorId);
  const headers = new Headers();
  headers.set("content-type", "application/json");
  applyConnectorAuth(headers, params.authType, secret, params.config);

  const mcpMethod =
    typeof params.config.mcpMethod === "string"
      ? params.config.mcpMethod
      : "tools/call";
  const mcpToolName =
    typeof params.config.mcpToolName === "string"
      ? params.config.mcpToolName
      : params.toolName;

  const response = await fetch(params.baseUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: mcpMethod,
      params: {
        name: mcpToolName,
        arguments: params.input,
      },
    }),
  });

  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

type ToolRiskLevel = "safe" | "gated" | "destructive";

function resolveToolRisk(policyJson: unknown): ToolRiskLevel {
  if (!policyJson || typeof policyJson !== "object") {
    return "safe";
  }

  const riskLevel = (policyJson as Record<string, unknown>).riskLevel;
  if (riskLevel === "gated" || riskLevel === "destructive") {
    return riskLevel;
  }
  return "safe";
}

function resultPreview(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > 500 ? `${value.slice(0, 500)}...[truncated]` : value;
  }

  if (typeof value === "object" && value !== null) {
    const serialized = JSON.stringify(value);
    if (serialized.length > 500) {
      return `${serialized.slice(0, 500)}...[truncated]`;
    }
    return value;
  }

  return value;
}

export interface BuildCustomToolsForUserInput {
  userId: string;
  executionTarget: ExecutionTarget;
  runId?: string;
}

export async function buildCustomToolsForUser(
  options: BuildCustomToolsForUserInput,
): Promise<ToolSet> {
  const customTools = await prisma.customTool.findMany({
    where: {
      userId: options.userId,
      enabled: true,
      publishState: ToolPublishState.PUBLISHED,
      executionTarget: {
        in: [options.executionTarget, ExecutionTarget.VERCEL],
      },
    },
    include: {
      connector: true,
    },
  });

  const toolset: ToolSet = {};

  for (const customTool of customTools) {
    if (!customTool.connector.baseUrl) {
      continue;
    }

    const runtimeToolName = sanitizeToolName(customTool.name, customTool.id);
    const connectorConfig = (customTool.connector.configJson ?? {}) as Record<
      string,
      unknown
    >;

    toolset[runtimeToolName] = tool({
      description: customTool.description,
      inputSchema: z.record(z.any()),
      execute: async (toolInput) => {
        if (options.runId) {
          await appendRunEvent(options.runId, "tool.started", {
            toolName: runtimeToolName,
            toolType: "custom",
            customToolId: customTool.id,
            connectorId: customTool.connector.id,
            input: toolInput,
          });
        }

        const riskLevel = resolveToolRisk(customTool.policyJson);
        if (
          (riskLevel === "gated" || riskLevel === "destructive") &&
          options.runId
        ) {
          await ensureToolApprovedOrRequest(options.runId, {
            kind: `tool.custom.${customTool.id}`,
            title: `Approve custom tool ${customTool.name}`,
            reason: `Custom tool '${customTool.name}' is marked as ${riskLevel}`,
            payload: {
              toolId: customTool.id,
              toolName: customTool.name,
              riskLevel,
            },
          });
        }

        const method =
          typeof connectorConfig.method === "string"
            ? connectorConfig.method.toUpperCase()
            : "POST";

        try {
          const result =
            customTool.connector.connectorType === ConnectorType.REST ||
            customTool.connector.connectorType === ConnectorType.GRAPHQL
              ? await invokeRestOrGraphqlTool({
                  baseUrl: customTool.connector.baseUrl!,
                  method,
                  config: connectorConfig,
                  authType: customTool.connector.authType,
                  connectorId: customTool.connector.id,
                  input: toolInput,
                })
              : await invokeMcpConnectorTool({
                  baseUrl: customTool.connector.baseUrl!,
                  config: connectorConfig,
                  authType: customTool.connector.authType,
                  connectorId: customTool.connector.id,
                  toolName: customTool.name,
                  input: toolInput,
                });

          if (options.runId) {
            await appendRunEvent(options.runId, "tool.completed", {
              toolName: runtimeToolName,
              toolType: "custom",
              customToolId: customTool.id,
              resultPreview: resultPreview(result),
            });
          }

          return result;
        } catch (error) {
          if (options.runId) {
            await appendRunEvent(options.runId, "tool.failed", {
              toolName: runtimeToolName,
              toolType: "custom",
              customToolId: customTool.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }

          throw error;
        }
      },
    });
  }

  return toolset;
}
