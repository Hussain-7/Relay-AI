"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

type Tab = "providers" | "models" | "github" | "connectors" | "mcp" | "tools";

interface ConnectorSummary {
  id: string;
  name: string;
}

interface CustomToolSummary {
  id: string;
  name: string;
  description: string;
  publishState: "DRAFT" | "PUBLISHED" | "DISABLED";
}

interface McpServerSummary {
  id: string;
  serverType: "REMOTE" | "LOCAL";
  configJson: unknown;
  status: string;
}

interface ModelsPayload {
  connected?: {
    openai?: boolean;
    anthropic?: boolean;
  };
  models?: Array<{
    id: string;
    provider: "OPENAI" | "ANTHROPIC";
    modelId: string;
    displayName: string;
    tier: string;
  }>;
  aliases?: Array<{
    id: string;
    alias: string;
    provider: "OPENAI" | "ANTHROPIC";
    modelId: string;
  }>;
}

function parseJsonObject(input: string): Record<string, unknown> {
  if (!input.trim()) {
    return {};
  }
  const parsed = JSON.parse(input) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function SettingsCenter(props: { userEmail: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [activeTab, setActiveTab] = useState<Tab>(
    ((searchParams.get("tab") as Tab | null) ?? "providers"),
  );

  const [provider, setProvider] = useState<"openai" | "anthropic">("openai");
  const [apiKey, setApiKey] = useState("");
  const [modelsPayload, setModelsPayload] = useState<ModelsPayload | null>(null);

  const [connectorName, setConnectorName] = useState("Internal API");
  const [connectorType, setConnectorType] = useState<"rest" | "graphql" | "mcp">(
    "rest",
  );
  const [connectorBaseUrl, setConnectorBaseUrl] = useState("");
  const [connectorAuthType, setConnectorAuthType] = useState<
    "none" | "api_key" | "bearer" | "oauth2"
  >("none");
  const [connectorConfigText, setConnectorConfigText] = useState("{}");
  const [connectorSecret, setConnectorSecret] = useState("");
  const [connectors, setConnectors] = useState<ConnectorSummary[]>([]);

  const [mcpServerType, setMcpServerType] = useState<"remote" | "local">("remote");
  const [mcpConfigText, setMcpConfigText] = useState(
    '{"name":"my-server","url":"https://mcp.example.com"}',
  );
  const [mcpServers, setMcpServers] = useState<McpServerSummary[]>([]);

  const [toolConnectorId, setToolConnectorId] = useState("");
  const [toolName, setToolName] = useState("custom_lookup");
  const [toolDescription, setToolDescription] = useState("Custom API lookup tool");
  const [toolExecutionTarget, setToolExecutionTarget] = useState<"vercel" | "e2b">(
    "vercel",
  );
  const [toolInputSchemaText, setToolInputSchemaText] = useState(
    '{"query":{"type":"string"}}',
  );
  const [toolOutputSchemaText, setToolOutputSchemaText] = useState(
    '{"result":{"type":"string"}}',
  );
  const [toolPolicyText, setToolPolicyText] = useState('{"riskLevel":"safe"}');
  const [tools, setTools] = useState<CustomToolSummary[]>([]);

  const tabLabel = useMemo(
    () => ({
      providers: "Providers",
      models: "Models",
      github: "GitHub",
      connectors: "Connectors",
      mcp: "MCP",
      tools: "Custom Tools",
    }),
    [],
  );

  const requestJson = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(path, {
        ...init,
        headers: {
          "content-type": "application/json",
          ...(init?.headers ?? {}),
        },
      });

      const text = await response.text();
      const payload = text ? (JSON.parse(text) as unknown) : null;
      if (!response.ok) {
        const message =
          payload &&
          typeof payload === "object" &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : `Request failed (${response.status})`;
        throw new Error(message);
      }

      return payload as T;
    },
    [],
  );

  const loadModels = useCallback(async () => {
    const payload = await requestJson<ModelsPayload>("/api/models");
    setModelsPayload(payload);
  }, [requestJson]);

  const loadConnectors = useCallback(async () => {
    const payload = await requestJson<{ connectors: ConnectorSummary[] }>(
      "/api/connectors",
    );
    setConnectors(payload.connectors);
    if (!toolConnectorId && payload.connectors[0]?.id) {
      setToolConnectorId(payload.connectors[0].id);
    }
  }, [requestJson, toolConnectorId]);

  const loadMcpServers = useCallback(async () => {
    const payload = await requestJson<{ servers: McpServerSummary[] }>(
      "/api/mcp/servers",
    );
    setMcpServers(payload.servers);
  }, [requestJson]);

  const loadTools = useCallback(async () => {
    const payload = await requestJson<{ tools: CustomToolSummary[] }>(
      "/api/tools/custom",
    );
    setTools(payload.tools);
  }, [requestJson]);

  useEffect(() => {
    void Promise.resolve()
      .then(async () => {
        await Promise.all([loadModels(), loadConnectors(), loadMcpServers(), loadTools()]);
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      });
  }, [loadConnectors, loadMcpServers, loadModels, loadTools]);

  async function withFeedback(successMessage: string, fn: () => Promise<void>) {
    setSaving(true);
    setError(null);
    setFeedback(null);
    try {
      await fn();
      setFeedback(successMessage);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setSaving(false);
    }
  }

  async function saveProviderKey(event: FormEvent) {
    event.preventDefault();
    await withFeedback("Provider key saved.", async () => {
      await requestJson("/api/providers/keys", {
        method: "POST",
        body: JSON.stringify({
          provider,
          apiKey,
        }),
      });
      setApiKey("");
      await loadModels();
    });
  }

  async function createConnector(event: FormEvent) {
    event.preventDefault();
    await withFeedback("Connector created.", async () => {
      await requestJson("/api/connectors", {
        method: "POST",
        body: JSON.stringify({
          name: connectorName,
          connectorType,
          baseUrl: connectorBaseUrl || undefined,
          authType: connectorAuthType,
          config: parseJsonObject(connectorConfigText),
          secret: connectorSecret || undefined,
          status: "active",
        }),
      });
      setConnectorSecret("");
      await loadConnectors();
    });
  }

  async function createMcpServer(event: FormEvent) {
    event.preventDefault();
    await withFeedback("MCP server added.", async () => {
      await requestJson("/api/mcp/servers", {
        method: "POST",
        body: JSON.stringify({
          serverType: mcpServerType,
          config: parseJsonObject(mcpConfigText),
          status: "active",
        }),
      });
      await loadMcpServers();
    });
  }

  async function createTool(event: FormEvent) {
    event.preventDefault();
    await withFeedback("Custom tool created.", async () => {
      await requestJson("/api/tools/custom", {
        method: "POST",
        body: JSON.stringify({
          connectorId: toolConnectorId,
          name: toolName,
          description: toolDescription,
          executionTarget: toolExecutionTarget,
          inputSchema: parseJsonObject(toolInputSchemaText),
          outputSchema: parseJsonObject(toolOutputSchemaText),
          policy: parseJsonObject(toolPolicyText),
          enabled: true,
        }),
      });
      await loadTools();
    });
  }

  async function publishTool(toolId: string) {
    await withFeedback("Tool published.", async () => {
      await requestJson(`/api/tools/custom/${toolId}/publish`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await loadTools();
    });
  }

  async function connectGithub() {
    await withFeedback("Opening GitHub app install flow...", async () => {
      const payload = await requestJson<{ installUrl: string }>(
        "/api/github/install-url",
      );
      window.location.href = payload.installUrl;
    });
  }

  async function signOut() {
    await withFeedback("Signing out...", async () => {
      await requestJson("/api/auth/sign-out", {
        method: "POST",
      });
      router.push("/");
      router.refresh();
    });
  }

  return (
    <main className="min-h-screen px-4 py-5 md:px-6 md:py-6">
      <div className="mx-auto w-full max-w-6xl rounded-3xl border border-white/40 bg-white/80 p-5 shadow-[0_18px_70px_rgba(16,26,41,0.12)] backdrop-blur md:p-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
              Profile & Settings
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">
              {tabLabel[activeTab]}
            </h1>
            <p className="text-sm text-slate-600">{props.userEmail}</p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/chat"
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700"
            >
              Back to chat
            </Link>
            <button
              type="button"
              onClick={() => {
                void signOut();
              }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700"
            >
              Sign out
            </button>
          </div>
        </header>

        <nav className="mt-5 flex flex-wrap gap-2">
          {(Object.keys(tabLabel) as Tab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                activeTab === tab
                  ? "bg-slate-900 text-white"
                  : "border border-slate-200 bg-white text-slate-700"
              }`}
            >
              {tabLabel[tab]}
            </button>
          ))}
        </nav>

        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5">
          {activeTab === "providers" ? (
            <form onSubmit={saveProviderKey} className="grid gap-3 md:grid-cols-4">
              <select
                value={provider}
                onChange={(event) =>
                  setProvider(event.target.value as "openai" | "anthropic")
                }
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
              </select>
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="API key"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm md:col-span-2"
              />
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Save key
              </button>
            </form>
          ) : null}

          {activeTab === "models" ? (
            <pre className="max-h-[420px] overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              {pretty(modelsPayload)}
            </pre>
          ) : null}

          {activeTab === "github" ? (
            <div>
              <p className="text-sm text-slate-600">
                Connect your GitHub App installation for remote coding and draft
                PR workflows.
              </p>
              <button
                type="button"
                onClick={() => {
                  void connectGithub();
                }}
                disabled={saving}
                className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Connect GitHub
              </button>
            </div>
          ) : null}

          {activeTab === "connectors" ? (
            <div className="space-y-4">
              <form onSubmit={createConnector} className="grid gap-2 md:grid-cols-2">
                <input
                  value={connectorName}
                  onChange={(event) => setConnectorName(event.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  placeholder="Connector name"
                />
                <input
                  value={connectorBaseUrl}
                  onChange={(event) => setConnectorBaseUrl(event.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  placeholder="https://api.example.com"
                />
                <select
                  value={connectorType}
                  onChange={(event) =>
                    setConnectorType(
                      event.target.value as "rest" | "graphql" | "mcp",
                    )
                  }
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="rest">REST</option>
                  <option value="graphql">GraphQL</option>
                  <option value="mcp">MCP</option>
                </select>
                <select
                  value={connectorAuthType}
                  onChange={(event) =>
                    setConnectorAuthType(
                      event.target.value as
                        | "none"
                        | "api_key"
                        | "bearer"
                        | "oauth2",
                    )
                  }
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="none">No auth</option>
                  <option value="api_key">API key</option>
                  <option value="bearer">Bearer</option>
                  <option value="oauth2">OAuth2</option>
                </select>
                <input
                  value={connectorSecret}
                  onChange={(event) => setConnectorSecret(event.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm md:col-span-2"
                  placeholder="Optional secret"
                />
                <textarea
                  value={connectorConfigText}
                  onChange={(event) => setConnectorConfigText(event.target.value)}
                  className="min-h-24 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm md:col-span-2"
                />
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 md:col-span-2"
                >
                  Create connector
                </button>
              </form>
              <pre className="max-h-[280px] overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                {pretty(connectors)}
              </pre>
            </div>
          ) : null}

          {activeTab === "mcp" ? (
            <div className="space-y-4">
              <form onSubmit={createMcpServer} className="grid gap-2 md:grid-cols-2">
                <select
                  value={mcpServerType}
                  onChange={(event) =>
                    setMcpServerType(event.target.value as "remote" | "local")
                  }
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="remote">Remote MCP</option>
                  <option value="local">Local MCP</option>
                </select>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  Add server
                </button>
                <textarea
                  value={mcpConfigText}
                  onChange={(event) => setMcpConfigText(event.target.value)}
                  className="min-h-24 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm md:col-span-2"
                />
              </form>
              <pre className="max-h-[280px] overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                {pretty(mcpServers)}
              </pre>
            </div>
          ) : null}

          {activeTab === "tools" ? (
            <div className="space-y-4">
              <form onSubmit={createTool} className="grid gap-2 md:grid-cols-2">
                <select
                  value={toolConnectorId}
                  onChange={(event) => setToolConnectorId(event.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Select connector</option>
                  {connectors.map((connector) => (
                    <option key={connector.id} value={connector.id}>
                      {connector.name}
                    </option>
                  ))}
                </select>
                <select
                  value={toolExecutionTarget}
                  onChange={(event) =>
                    setToolExecutionTarget(event.target.value as "vercel" | "e2b")
                  }
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="vercel">Vercel</option>
                  <option value="e2b">E2B</option>
                </select>
                <input
                  value={toolName}
                  onChange={(event) => setToolName(event.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  placeholder="tool name"
                />
                <input
                  value={toolDescription}
                  onChange={(event) => setToolDescription(event.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  placeholder="description"
                />
                <textarea
                  value={toolInputSchemaText}
                  onChange={(event) => setToolInputSchemaText(event.target.value)}
                  className="min-h-24 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                />
                <textarea
                  value={toolOutputSchemaText}
                  onChange={(event) => setToolOutputSchemaText(event.target.value)}
                  className="min-h-24 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                />
                <textarea
                  value={toolPolicyText}
                  onChange={(event) => setToolPolicyText(event.target.value)}
                  className="min-h-20 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm md:col-span-2"
                />
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 md:col-span-2"
                >
                  Create tool
                </button>
              </form>
              <div className="space-y-2">
                {tools.map((tool) => (
                  <div
                    key={tool.id}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                  >
                    <p className="text-sm font-semibold text-slate-900">{tool.name}</p>
                    <p className="text-xs text-slate-600">{tool.description}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      State: {tool.publishState}
                    </p>
                    {tool.publishState !== "PUBLISHED" ? (
                      <button
                        type="button"
                        onClick={() => {
                          void publishTool(tool.id);
                        }}
                        className="mt-2 rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white"
                      >
                        Publish
                      </button>
                    ) : null}
                  </div>
                ))}
                {tools.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500">
                    No custom tools yet.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>

        {feedback ? <p className="mt-3 text-sm text-emerald-600">{feedback}</p> : null}
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      </div>
    </main>
  );
}
