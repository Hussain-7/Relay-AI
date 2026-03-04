"use client";

import { createClient } from "@supabase/supabase-js";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type JsonRecord = Record<string, unknown>;

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

interface ConnectorSummary {
  id: string;
  name: string;
  [key: string]: unknown;
}

interface CustomToolSummary {
  id: string;
  name: string;
  description?: string;
  publishState?: string;
  [key: string]: unknown;
}

interface McpServerSummary {
  id: string;
  [key: string]: unknown;
}

interface AgentRunResponse {
  status?: string;
  runId?: string;
  conversationId?: string;
  codingSessionId?: string;
  result?: { text?: string };
  approval?: { id?: string };
  [key: string]: unknown;
}

interface RunEventEntry {
  id: string;
  runId: string;
  type: string;
  ts: string;
  payload: unknown;
}

function parseJsonObject(input: string, fallback: JsonRecord = {}): JsonRecord {
  if (!input.trim()) {
    return fallback;
  }

  const parsed = JSON.parse(input);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object");
  }
  return parsed as JsonRecord;
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function AppConsole() {
  const [userId, setUserId] = useState("demo-user");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [provider, setProvider] = useState<"openai" | "anthropic">("openai");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<unknown>(null);

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const [agentMode, setAgentMode] = useState<"agent" | "coding">("agent");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [lastRun, setLastRun] = useState<unknown>(null);
  const [pendingApproval, setPendingApproval] = useState<{
    runId: string;
    approvalId?: string;
  } | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runEvents, setRunEvents] = useState<RunEventEntry[]>([]);
  const [realtimeStatus, setRealtimeStatus] = useState<string>("idle");

  const [repoFullName, setRepoFullName] = useState("owner/repo");
  const [baseBranch, setBaseBranch] = useState("main");
  const [codingSessionId, setCodingSessionId] = useState<string | null>(null);
  const [execCommand, setExecCommand] = useState("pwd && ls -la");
  const [execResult, setExecResult] = useState<unknown>(null);

  const [connectors, setConnectors] = useState<ConnectorSummary[]>([]);
  const [connectorName, setConnectorName] = useState("Internal API");
  const [connectorType, setConnectorType] = useState<
    "rest" | "graphql" | "mcp"
  >("rest");
  const [connectorBaseUrl, setConnectorBaseUrl] = useState(
    "https://api.example.com/endpoint",
  );
  const [connectorAuthType, setConnectorAuthType] = useState<
    "none" | "api_key" | "bearer" | "oauth2"
  >("none");
  const [connectorSecret, setConnectorSecret] = useState("");
  const [connectorConfigText, setConnectorConfigText] =
    useState('{"method":"POST"}');

  const [tools, setTools] = useState<CustomToolSummary[]>([]);
  const [toolConnectorId, setToolConnectorId] = useState("");
  const [toolName, setToolName] = useState("custom_lookup");
  const [toolDescription, setToolDescription] = useState("Custom API tool");
  const [toolExecutionTarget, setToolExecutionTarget] = useState<
    "vercel" | "e2b"
  >("vercel");
  const [toolInputSchemaText, setToolInputSchemaText] = useState(
    '{"query":{"type":"string"}}',
  );
  const [toolOutputSchemaText, setToolOutputSchemaText] = useState(
    '{"result":{"type":"string"}}',
  );
  const [toolPolicyText, setToolPolicyText] = useState('{"riskLevel":"safe"}');

  const [mcpServers, setMcpServers] = useState<McpServerSummary[]>([]);
  const [mcpServerType, setMcpServerType] = useState<"remote" | "local">(
    "remote",
  );
  const [mcpConfigText, setMcpConfigText] = useState(
    '{"name":"doc-search","url":"https://mcp.example.com"}',
  );

  const requestHeaders = useMemo(
    () => ({
      "content-type": "application/json",
      ...(userId ? { "x-user-id": userId } : {}),
    }),
    [userId],
  );

  const requestJson = useCallback(
    async <T = unknown,>(path: string, init?: RequestInit): Promise<T> => {
      setError(null);

      const response = await fetch(path, {
        ...init,
        headers: {
          ...requestHeaders,
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
    [requestHeaders],
  );

  const toRunEventEntry = useCallback(
    (value: unknown): RunEventEntry | null => {
      if (!value || typeof value !== "object") {
        return null;
      }

      const row = value as Record<string, unknown>;
      const id = typeof row.id === "string" ? row.id : null;
      const runId = typeof row.runId === "string" ? row.runId : activeRunId;
      const type = typeof row.type === "string" ? row.type : null;
      const ts = typeof row.ts === "string" ? row.ts : new Date().toISOString();
      const payload =
        "payload" in row
          ? row.payload
          : "payloadJson" in row
            ? row.payloadJson
            : null;

      if (!id || !runId || !type) {
        return null;
      }

      return {
        id,
        runId,
        type,
        ts,
        payload,
      };
    },
    [activeRunId],
  );

  const mergeRunEvents = useCallback(
    (prev: RunEventEntry[], incoming: RunEventEntry[]): RunEventEntry[] => {
      const map = new Map(prev.map((event) => [event.id, event]));
      for (const event of incoming) {
        map.set(event.id, event);
      }
      return [...map.values()].sort((a, b) => a.ts.localeCompare(b.ts));
    },
    [],
  );

  const loadRunEvents = useCallback(
    async (runId: string) => {
      const payload = await requestJson<{
        events?: Array<Record<string, unknown>>;
      }>(`/api/agent/runs/${runId}/events`);
      const parsed = (payload.events ?? [])
        .map((item) => toRunEventEntry(item))
        .filter((item): item is RunEventEntry => item !== null);
      setRunEvents(parsed);
    },
    [requestJson, toRunEventEntry],
  );

  useEffect(() => {
    if (!activeRunId) {
      return;
    }

    void Promise.resolve()
      .then(() => loadRunEvents(activeRunId))
      .catch(() => {
        setRealtimeStatus("load_failed");
      });

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      return;
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const channel = supabase.channel(`run:${activeRunId}`);

    channel.on("broadcast", { event: "run.event" }, (payload) => {
      const parsed = toRunEventEntry(payload.payload);
      if (!parsed) {
        return;
      }
      setRunEvents((prev) => mergeRunEvents(prev, [parsed]));
    });

    channel.subscribe((status) => {
      setRealtimeStatus(status.toLowerCase());
    });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [activeRunId, loadRunEvents, mergeRunEvents, toRunEventEntry]);

  async function handleWithFeedback(
    fn: () => Promise<void>,
    successMessage: string,
  ) {
    try {
      setFeedback(null);
      await fn();
      setFeedback(successMessage);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : String(requestError),
      );
    }
  }

  async function saveProviderKey(event: FormEvent) {
    event.preventDefault();
    await handleWithFeedback(async () => {
      await requestJson("/api/providers/keys", {
        method: "POST",
        body: JSON.stringify({
          userId,
          provider,
          apiKey,
        }),
      });
      setApiKey("");
    }, "Provider key saved.");
  }

  async function loadModels() {
    await handleWithFeedback(async () => {
      const data = await requestJson("/api/models");
      setModels(data);
    }, "Models loaded.");
  }

  async function sendChat(event: FormEvent) {
    event.preventDefault();
    const prompt = chatInput.trim();
    if (!prompt) return;

    await handleWithFeedback(async () => {
      setChatMessages((prev) => [...prev, { role: "user", text: prompt }]);
      setChatInput("");

      const payload = await requestJson<AgentRunResponse>("/api/agent/runs", {
        method: "POST",
        body: JSON.stringify({
          userId,
          conversationId,
          mode: "chat",
          userMessage: prompt,
        }),
      });

      if (payload.conversationId) {
        setConversationId(payload.conversationId);
      }
      if (payload.codingSessionId) {
        setCodingSessionId(payload.codingSessionId);
      }
      if (payload.runId) {
        setActiveRunId(payload.runId);
      }

      const assistantText =
        payload?.result?.text ?? "No assistant text returned";
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", text: assistantText },
      ]);
      setLastRun(payload);
    }, "Chat turn completed.");
  }

  async function runAgent(event: FormEvent) {
    event.preventDefault();
    const prompt = agentPrompt.trim();
    if (!prompt) return;

    await handleWithFeedback(async () => {
      const payload = await requestJson<AgentRunResponse>("/api/agent/runs", {
        method: "POST",
        body: JSON.stringify({
          userId,
          mode: agentMode,
          userMessage: prompt,
          conversationId,
          ...(agentMode === "coding"
            ? {
                codingSessionId: codingSessionId ?? undefined,
                repoFullName,
                baseBranch,
              }
            : {}),
        }),
      });

      setLastRun(payload);
      if (payload.runId) {
        setActiveRunId(payload.runId);
      }
      if (payload.conversationId) {
        setConversationId(payload.conversationId);
      }

      if (payload.status === "approval_required" && payload.runId) {
        setPendingApproval({
          runId: payload.runId,
          approvalId: payload.approval?.id,
        });
      } else {
        setPendingApproval(null);
      }
    }, `Run started in ${agentMode} mode.`);
  }

  async function approveRun() {
    if (!pendingApproval) return;

    await handleWithFeedback(async () => {
      const payload = await requestJson<AgentRunResponse>(
        `/api/agent/runs/${pendingApproval.runId}/approve`,
        {
          method: "POST",
          body: JSON.stringify({
            userId,
            approvalId: pendingApproval.approvalId,
            approve: true,
          }),
        },
      );
      setLastRun(payload);
      if (payload.status === "approval_required" && payload.runId) {
        setPendingApproval({
          runId: payload.runId,
          approvalId: payload.approval?.id,
        });
      } else {
        setPendingApproval(null);
      }
      if (payload.runId) {
        setActiveRunId(payload.runId);
      }
    }, "Run approval submitted.");
  }

  async function createCodingSession(event: FormEvent) {
    event.preventDefault();

    await handleWithFeedback(async () => {
      const payload = await requestJson<{ session?: { id?: string } }>(
        "/api/coding/sessions",
        {
          method: "POST",
          body: JSON.stringify({
            userId,
            repoFullName,
            baseBranch,
            autoConnect: true,
          }),
        },
      );

      setCodingSessionId(payload?.session?.id ?? null);
      setLastRun(payload);
    }, "Coding session created.");
  }

  async function execInCodingSession(event: FormEvent) {
    event.preventDefault();
    if (!codingSessionId) {
      setError("Create a coding session first.");
      return;
    }

    await handleWithFeedback(async () => {
      const payload = await requestJson(
        `/api/coding/sessions/${codingSessionId}/exec`,
        {
          method: "POST",
          body: JSON.stringify({
            userId,
            command: execCommand,
            cwd: "/workspace/repo",
          }),
        },
      );

      setExecResult(payload);
    }, "Command executed in sandbox.");
  }

  async function loadConnectors() {
    await handleWithFeedback(async () => {
      const payload = await requestJson<{ connectors?: ConnectorSummary[] }>(
        "/api/connectors",
      );
      setConnectors(payload.connectors ?? []);
      if (!toolConnectorId && payload.connectors?.[0]?.id) {
        setToolConnectorId(payload.connectors[0].id);
      }
    }, "Connectors loaded.");
  }

  async function createConnector(event: FormEvent) {
    event.preventDefault();

    await handleWithFeedback(async () => {
      const payload = await requestJson<{ connector: ConnectorSummary }>(
        "/api/connectors",
        {
          method: "POST",
          body: JSON.stringify({
            userId,
            name: connectorName,
            connectorType,
            baseUrl: connectorBaseUrl || undefined,
            authType: connectorAuthType,
            config: parseJsonObject(connectorConfigText),
            secret: connectorSecret || undefined,
          }),
        },
      );

      setConnectors((prev) => [payload.connector, ...prev]);
      if (!toolConnectorId) {
        setToolConnectorId(payload.connector.id);
      }
      setConnectorSecret("");
    }, "Connector created.");
  }

  async function loadTools() {
    await handleWithFeedback(async () => {
      const payload = await requestJson<{ tools?: CustomToolSummary[] }>(
        "/api/tools/custom",
      );
      setTools(payload.tools ?? []);
    }, "Custom tools loaded.");
  }

  async function createTool(event: FormEvent) {
    event.preventDefault();

    await handleWithFeedback(async () => {
      const payload = await requestJson<{ tool: CustomToolSummary }>(
        "/api/tools/custom",
        {
          method: "POST",
          body: JSON.stringify({
            userId,
            connectorId: toolConnectorId,
            name: toolName,
            description: toolDescription,
            executionTarget: toolExecutionTarget,
            inputSchema: parseJsonObject(toolInputSchemaText),
            outputSchema: parseJsonObject(toolOutputSchemaText),
            policy: parseJsonObject(toolPolicyText),
          }),
        },
      );

      setTools((prev) => [payload.tool, ...prev]);
    }, "Custom tool created.");
  }

  async function publishTool(toolId: string) {
    await handleWithFeedback(async () => {
      await requestJson(`/api/tools/custom/${toolId}/publish`, {
        method: "POST",
        body: JSON.stringify({ userId }),
      });
      await loadTools();
    }, "Tool published.");
  }

  async function loadMcpServers() {
    await handleWithFeedback(async () => {
      const payload = await requestJson<{ servers?: McpServerSummary[] }>(
        "/api/mcp/servers",
      );
      setMcpServers(payload.servers ?? []);
    }, "MCP servers loaded.");
  }

  async function createMcpServer(event: FormEvent) {
    event.preventDefault();

    await handleWithFeedback(async () => {
      const payload = await requestJson<{ server: McpServerSummary }>(
        "/api/mcp/servers",
        {
          method: "POST",
          body: JSON.stringify({
            userId,
            serverType: mcpServerType,
            config: parseJsonObject(mcpConfigText),
            status: "active",
          }),
        },
      );

      setMcpServers((prev) => [payload.server, ...prev]);
    }, "MCP server created.");
  }

  async function startGithubInstall() {
    await handleWithFeedback(async () => {
      const payload = await requestJson<{ installUrl: string }>(
        "/api/github/install-url",
      );
      window.open(payload.installUrl, "_blank", "noopener,noreferrer");
    }, "Opened GitHub App install flow.");
  }

  return (
    <div className="grid gap-6">
      <section className="rounded-xl border border-black/10 bg-panel p-5">
        <h2 className="text-lg font-semibold">Session Context</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-[160px_1fr] md:items-center">
          <label htmlFor="user-id" className="text-sm text-muted">
            User ID
          </label>
          <input
            id="user-id"
            className="rounded-md border border-black/15 bg-white/80 px-3 py-2 text-sm"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
          />
        </div>
        <p className="mt-2 text-xs text-muted">
          `x-user-id` header is used when Supabase bearer token is not provided
          (non-production fallback).
        </p>
        {feedback ? (
          <p className="mt-3 text-sm text-accent-2">{feedback}</p>
        ) : null}
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      </section>

      <section className="rounded-xl border border-black/10 bg-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Provider BYOK</h2>
          <button
            type="button"
            onClick={loadModels}
            className="rounded-md border border-black/20 px-3 py-1.5 text-sm hover:bg-black/5"
          >
            Refresh Models
          </button>
        </div>
        <form
          className="mt-4 grid gap-3 md:grid-cols-4"
          onSubmit={saveProviderKey}
        >
          <select
            className="rounded-md border border-black/15 bg-white/80 px-3 py-2 text-sm"
            value={provider}
            onChange={(event) =>
              setProvider(event.target.value as "openai" | "anthropic")
            }
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </select>
          <input
            className="rounded-md border border-black/15 bg-white/80 px-3 py-2 text-sm md:col-span-2"
            type="password"
            value={apiKey}
            placeholder="Provider API key"
            onChange={(event) => setApiKey(event.target.value)}
          />
          <button
            type="submit"
            className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white"
          >
            Save Key
          </button>
        </form>
        <pre className="mt-4 max-h-48 overflow-auto rounded-md bg-black/5 p-3 text-xs">
          {pretty(models)}
        </pre>
      </section>

      <section className="rounded-xl border border-black/10 bg-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Chat Interface</h2>
          <span className="text-xs text-muted">
            Conversation: {conversationId ?? "new"}
          </span>
        </div>
        <div className="mt-3 max-h-72 space-y-3 overflow-auto rounded-md border border-black/10 p-3">
          {chatMessages.length === 0 ? (
            <p className="text-sm text-muted">No messages yet.</p>
          ) : null}
          {chatMessages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className="rounded-md bg-black/5 p-3 text-sm"
            >
              <p className="text-xs uppercase tracking-wide text-muted">
                {message.role}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{message.text}</p>
            </div>
          ))}
        </div>
        <form className="mt-3 flex gap-2" onSubmit={sendChat}>
          <input
            className="flex-1 rounded-md border border-black/15 bg-white/80 px-3 py-2 text-sm"
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
            placeholder="Ask a question"
          />
          <button
            type="submit"
            className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white"
          >
            Send
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-black/10 bg-panel p-5">
        <h2 className="text-lg font-semibold">Agent Runs</h2>
        <form
          className="mt-3 grid gap-3 md:grid-cols-[140px_1fr_auto]"
          onSubmit={runAgent}
        >
          <select
            className="rounded-md border border-black/15 bg-white/80 px-3 py-2 text-sm"
            value={agentMode}
            onChange={(event) =>
              setAgentMode(event.target.value as "agent" | "coding")
            }
          >
            <option value="agent">Agent mode</option>
            <option value="coding">Coding mode</option>
          </select>
          <input
            className="rounded-md border border-black/15 bg-white/80 px-3 py-2 text-sm"
            value={agentPrompt}
            onChange={(event) => setAgentPrompt(event.target.value)}
            placeholder="Run goal"
          />
          <button
            type="submit"
            className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white"
          >
            Run
          </button>
        </form>
        {pendingApproval ? (
          <button
            type="button"
            onClick={approveRun}
            className="mt-3 rounded-md border border-black/20 px-3 py-1.5 text-sm hover:bg-black/5"
          >
            Approve Pending Action
          </button>
        ) : null}
        <pre className="mt-4 max-h-64 overflow-auto rounded-md bg-black/5 p-3 text-xs">
          {pretty(lastRun)}
        </pre>
      </section>

      <section className="rounded-xl border border-black/10 bg-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Run Event Stream</h2>
          <button
            type="button"
            onClick={() => {
              if (!activeRunId) return;
              void loadRunEvents(activeRunId).catch((loadError) => {
                setError(
                  loadError instanceof Error
                    ? loadError.message
                    : String(loadError),
                );
              });
            }}
            className="rounded-md border border-black/20 px-3 py-1.5 text-sm hover:bg-black/5"
          >
            Refresh
          </button>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-[180px_1fr] md:items-center">
          <label htmlFor="active-run-id" className="text-sm text-muted">
            Active run
          </label>
          <input
            id="active-run-id"
            className="rounded-md border border-black/15 bg-white/80 px-3 py-2 text-sm"
            value={activeRunId ?? ""}
            onChange={(event) => {
              const nextRunId = event.target.value.trim() || null;
              setActiveRunId(nextRunId);
              if (!nextRunId) {
                setRunEvents([]);
                setRealtimeStatus("idle");
              }
            }}
            placeholder="run id"
          />
        </div>
        <p className="mt-2 text-xs text-muted">
          Realtime status: {realtimeStatus}
        </p>
        <div className="mt-3 max-h-64 space-y-2 overflow-auto rounded-md border border-black/10 p-3">
          {runEvents.length === 0 ? (
            <p className="text-sm text-muted">No run events loaded.</p>
          ) : null}
          {runEvents.map((event) => (
            <div key={event.id} className="rounded-md bg-black/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide">
                  {event.type}
                </p>
                <p className="text-[11px] text-muted">
                  {new Date(event.ts).toLocaleString()}
                </p>
              </div>
              <pre className="mt-2 overflow-auto text-xs text-muted">
                {pretty(event.payload)}
              </pre>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-black/10 bg-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Coding Session (E2B)</h2>
          <button
            type="button"
            onClick={startGithubInstall}
            className="rounded-md border border-black/20 px-3 py-1.5 text-sm hover:bg-black/5"
          >
            Connect GitHub App
          </button>
        </div>
        <form
          className="mt-3 grid gap-2 md:grid-cols-[1fr_150px_auto]"
          onSubmit={createCodingSession}
        >
          <input
            className="rounded-md border border-black/15 bg-white/80 px-3 py-2 text-sm"
            value={repoFullName}
            onChange={(event) => setRepoFullName(event.target.value)}
            placeholder="owner/repo"
          />
          <input
            className="rounded-md border border-black/15 bg-white/80 px-3 py-2 text-sm"
            value={baseBranch}
            onChange={(event) => setBaseBranch(event.target.value)}
            placeholder="base branch"
          />
          <button
            type="submit"
            className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white"
          >
            Create
          </button>
        </form>
        <p className="mt-2 text-xs text-muted">
          Active session: {codingSessionId ?? "none"}
        </p>
        <form className="mt-3 flex gap-2" onSubmit={execInCodingSession}>
          <input
            className="flex-1 rounded-md border border-black/15 bg-white/80 px-3 py-2 text-sm"
            value={execCommand}
            onChange={(event) => setExecCommand(event.target.value)}
            placeholder="command"
          />
          <button
            type="submit"
            className="rounded-md border border-black/20 px-3 py-2 text-sm hover:bg-black/5"
          >
            Exec
          </button>
        </form>
        <pre className="mt-4 max-h-56 overflow-auto rounded-md bg-black/5 p-3 text-xs">
          {pretty(execResult)}
        </pre>
      </section>

      <section className="rounded-xl border border-black/10 bg-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Connector Manager</h2>
          <button
            type="button"
            onClick={loadConnectors}
            className="rounded-md border border-black/20 px-3 py-1.5 text-sm hover:bg-black/5"
          >
            Refresh
          </button>
        </div>
        <form
          className="mt-3 grid gap-2 md:grid-cols-2"
          onSubmit={createConnector}
        >
          <input
            className="rounded-md border border-black/15 bg-white/80 px-3 py-2 text-sm"
            value={connectorName}
            onChange={(event) => setConnectorName(event.target.value)}
            placeholder="Connector name"
          />
          <input
            className="rounded-md border border-black/15 bg-white/80 px-3 py-2 text-sm"
            value={connectorBaseUrl}
            onChange={(event) => setConnectorBaseUrl(event.target.value)}
            placeholder="Base URL"
          />
          <select
            className="rounded-md border border-black/15 bg-white/80 px-3 py-2 text-sm"
            value={connectorType}
            onChange={(event) =>
              setConnectorType(event.target.value as "rest" | "graphql" | "mcp")
            }
          >
            <option value="rest">REST</option>
            <option value="graphql">GraphQL</option>
            <option value="mcp">MCP</option>
          </select>
          <select
            className="rounded-md border border-black/15 bg-white/80 px-3 py-2 text-sm"
            value={connectorAuthType}
            onChange={(event) =>
              setConnectorAuthType(
                event.target.value as "none" | "api_key" | "bearer" | "oauth2",
              )
            }
          >
            <option value="none">No auth</option>
            <option value="api_key">API key</option>
            <option value="bearer">Bearer</option>
            <option value="oauth2">OAuth2 token</option>
          </select>
          <input
            className="rounded-md border border-black/15 bg-white/80 px-3 py-2 text-sm md:col-span-2"
            value={connectorSecret}
            onChange={(event) => setConnectorSecret(event.target.value)}
            placeholder="Optional secret"
          />
          <textarea
            className="min-h-24 rounded-md border border-black/15 bg-white/80 px-3 py-2 text-sm md:col-span-2"
            value={connectorConfigText}
            onChange={(event) => setConnectorConfigText(event.target.value)}
          />
          <button
            type="submit"
            className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white md:col-span-2"
          >
            Create Connector
          </button>
        </form>
        <pre className="mt-4 max-h-64 overflow-auto rounded-md bg-black/5 p-3 text-xs">
          {pretty(connectors)}
        </pre>
      </section>

      <section className="rounded-xl border border-black/10 bg-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Custom Tool Builder</h2>
          <button
            type="button"
            onClick={loadTools}
            className="rounded-md border border-black/20 px-3 py-1.5 text-sm hover:bg-black/5"
          >
            Refresh
          </button>
        </div>
        <form className="mt-3 grid gap-2 md:grid-cols-2" onSubmit={createTool}>
          <select
            className="rounded-md border border-black/15 bg-white/80 px-3 py-2 text-sm"
            value={toolConnectorId}
            onChange={(event) => setToolConnectorId(event.target.value)}
          >
            <option value="">Select connector</option>
            {connectors.map((connector) => (
              <option key={connector.id} value={connector.id}>
                {connector.name}
              </option>
            ))}
          </select>
          <select
            className="rounded-md border border-black/15 bg-white/80 px-3 py-2 text-sm"
            value={toolExecutionTarget}
            onChange={(event) =>
              setToolExecutionTarget(event.target.value as "vercel" | "e2b")
            }
          >
            <option value="vercel">Vercel</option>
            <option value="e2b">E2B</option>
          </select>
          <input
            className="rounded-md border border-black/15 bg-white/80 px-3 py-2 text-sm"
            value={toolName}
            onChange={(event) => setToolName(event.target.value)}
            placeholder="tool name"
          />
          <input
            className="rounded-md border border-black/15 bg-white/80 px-3 py-2 text-sm"
            value={toolDescription}
            onChange={(event) => setToolDescription(event.target.value)}
            placeholder="tool description"
          />
          <textarea
            className="min-h-20 rounded-md border border-black/15 bg-white/80 px-3 py-2 text-sm"
            value={toolInputSchemaText}
            onChange={(event) => setToolInputSchemaText(event.target.value)}
          />
          <textarea
            className="min-h-20 rounded-md border border-black/15 bg-white/80 px-3 py-2 text-sm"
            value={toolOutputSchemaText}
            onChange={(event) => setToolOutputSchemaText(event.target.value)}
          />
          <textarea
            className="min-h-20 rounded-md border border-black/15 bg-white/80 px-3 py-2 text-sm md:col-span-2"
            value={toolPolicyText}
            onChange={(event) => setToolPolicyText(event.target.value)}
          />
          <button
            type="submit"
            className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white md:col-span-2"
          >
            Create Tool
          </button>
        </form>

        <div className="mt-4 grid gap-2">
          {tools.map((tool) => (
            <div
              key={tool.id}
              className="rounded-md border border-black/10 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{tool.name}</p>
                  <p className="text-xs text-muted">{tool.description}</p>
                </div>
                <button
                  type="button"
                  onClick={() => publishTool(tool.id)}
                  className="rounded-md border border-black/20 px-2 py-1 text-xs hover:bg-black/5"
                >
                  Publish
                </button>
              </div>
              <p className="mt-2 text-xs text-muted">
                State: {tool.publishState}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-black/10 bg-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">MCP Servers</h2>
          <button
            type="button"
            onClick={loadMcpServers}
            className="rounded-md border border-black/20 px-3 py-1.5 text-sm hover:bg-black/5"
          >
            Refresh
          </button>
        </div>
        <form
          className="mt-3 grid gap-2 md:grid-cols-[180px_1fr_auto]"
          onSubmit={createMcpServer}
        >
          <select
            className="rounded-md border border-black/15 bg-white/80 px-3 py-2 text-sm"
            value={mcpServerType}
            onChange={(event) =>
              setMcpServerType(event.target.value as "remote" | "local")
            }
          >
            <option value="remote">Remote MCP</option>
            <option value="local">Local MCP (E2B)</option>
          </select>
          <textarea
            className="min-h-20 rounded-md border border-black/15 bg-white/80 px-3 py-2 text-sm"
            value={mcpConfigText}
            onChange={(event) => setMcpConfigText(event.target.value)}
          />
          <button
            type="submit"
            className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white"
          >
            Add
          </button>
        </form>
        <pre className="mt-4 max-h-52 overflow-auto rounded-md bg-black/5 p-3 text-xs">
          {pretty(mcpServers)}
        </pre>
      </section>
    </div>
  );
}
