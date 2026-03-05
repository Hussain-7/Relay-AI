"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Mode = "chat" | "agent" | "coding";
type ProviderChoice = "auto" | "openai" | "anthropic";

interface ConversationListItem {
  id: string;
  title: string;
  defaultMode: Mode;
  updatedAt: string;
  lastMessage: {
    role?: string;
    contentJson?: unknown;
  } | null;
}

interface ChatMessageRecord {
  id?: string;
  role: "user" | "assistant";
  text: string;
  createdAt?: string;
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
  }>;
}

interface RunEventEntry {
  id: string;
  runId: string;
  type: string;
  ts: string;
  payload: unknown;
}

interface RunState {
  id: string;
  status: string;
  finalMessageJson: unknown;
  approvals?: Array<{
    id: string;
    status: "PENDING" | "APPROVED" | "REJECTED";
    kind: string;
    proposalJson: unknown;
  }>;
}

function extractMessageText(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (typeof content !== "object") return String(content);
  const record = content as Record<string, unknown>;
  if (typeof record.text === "string") {
    return record.text;
  }
  return JSON.stringify(content);
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function shortTime(value: string): string {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ChatWorkspace(props: {
  user: {
    fullName: string | null;
    email: string;
  };
  initialConversationId?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [conversationQuery, setConversationQuery] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(
    props.initialConversationId ?? null,
  );
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [streamingAssistant, setStreamingAssistant] = useState("");

  const [mode, setMode] = useState<Mode>("chat");
  const [provider, setProvider] = useState<ProviderChoice>("auto");
  const [modelId, setModelId] = useState<string>("");
  const [modelsPayload, setModelsPayload] = useState<ModelsPayload | null>(null);

  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);

  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<string>("idle");
  const [runEvents, setRunEvents] = useState<RunEventEntry[]>([]);
  const [pendingApproval, setPendingApproval] = useState<{
    runId: string;
    approvalId: string;
  } | null>(null);
  const [finalizedRunIds, setFinalizedRunIds] = useState<string[]>([]);

  const [repoFullName, setRepoFullName] = useState("owner/repo");
  const [baseBranch, setBaseBranch] = useState("main");
  const [codingSessionId, setCodingSessionId] = useState<string | null>(null);

  const filteredConversations = useMemo(() => {
    if (!conversationQuery.trim()) {
      return conversations;
    }

    const needle = conversationQuery.toLowerCase();
    return conversations.filter((conversation) =>
      conversation.title.toLowerCase().includes(needle),
    );
  }, [conversationQuery, conversations]);

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

  const loadConversations = useCallback(async () => {
    const data = await requestJson<{ conversations: ConversationListItem[] }>(
      "/api/conversations?limit=60",
    );
    setConversations(data.conversations);
  }, [requestJson]);

  const loadMessages = useCallback(
    async (id: string) => {
      const data = await requestJson<{
        messages: Array<{
          id: string;
          role: "user" | "assistant";
          contentJson: unknown;
          createdAt: string;
        }>;
      }>(`/api/conversations/${id}/messages?limit=400`);

      setMessages(
        data.messages.map((message) => ({
          id: message.id,
          role: message.role,
          text: extractMessageText(message.contentJson),
          createdAt: message.createdAt,
        })),
      );
    },
    [requestJson],
  );

  const loadModels = useCallback(async () => {
    try {
      const data = await requestJson<ModelsPayload>("/api/models");
      setModelsPayload(data);
      if (!modelId && data.models && data.models.length > 0) {
        setModelId(data.models[0].modelId);
      }
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : String(loadError);
      setError(message);
    }
  }, [modelId, requestJson]);

  const loadRunEvents = useCallback(
    async (runId: string) => {
      const data = await requestJson<{
        events: Array<{
          id: string;
          runId: string;
          type: string;
          ts: string;
          payloadJson?: unknown;
          payload?: unknown;
        }>;
      }>(`/api/agent/runs/${runId}/events`);

      const mapped = data.events.map((event) => ({
        id: event.id,
        runId: event.runId,
        type: event.type,
        ts: event.ts,
        payload: event.payload ?? event.payloadJson ?? null,
      }));
      setRunEvents(mapped);
    },
    [requestJson],
  );

  const syncRunState = useCallback(
    async (runId: string) => {
      const data = await requestJson<{ run: RunState }>(`/api/agent/runs/${runId}`);
      setRunStatus(data.run.status);

      const pending = data.run.approvals?.find(
        (item) => item.status === "PENDING",
      );
      if (pending) {
        setPendingApproval({
          runId,
          approvalId: pending.id,
        });
      } else {
        setPendingApproval(null);
      }

      if (
        data.run.status === "COMPLETED" &&
        !finalizedRunIds.includes(runId) &&
        data.run.finalMessageJson
      ) {
        const text = extractMessageText(data.run.finalMessageJson);
        if (text.trim()) {
          setMessages((prev) => [...prev, { role: "assistant", text }]);
        }
        setFinalizedRunIds((prev) => [...prev, runId]);
      }
    },
    [finalizedRunIds, requestJson],
  );

  useEffect(() => {
    void Promise.resolve()
      .then(async () => {
        await Promise.all([loadConversations(), loadModels()]);
        if (conversationId) {
          await loadMessages(conversationId);
        }
      })
      .catch((bootstrapError) => {
        const message =
          bootstrapError instanceof Error
            ? bootstrapError.message
            : String(bootstrapError);
        setError(message);
      });
  }, [conversationId, loadConversations, loadMessages, loadModels]);

  useEffect(() => {
    if (!activeRunId) {
      return;
    }

    let cancelled = false;
    const interval = setInterval(() => {
      if (cancelled) {
        return;
      }

      void Promise.resolve()
        .then(async () => {
          await Promise.all([loadRunEvents(activeRunId), syncRunState(activeRunId)]);
        })
        .catch((pollError) => {
          const message =
            pollError instanceof Error ? pollError.message : String(pollError);
          setError(message);
        });
    }, 2200);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeRunId, loadRunEvents, syncRunState]);

  async function createNewConversation() {
    try {
      setError(null);
      const data = await requestJson<{ conversation: ConversationListItem }>(
        "/api/conversations",
        {
          method: "POST",
          body: JSON.stringify({
            title: "New Chat",
            defaultMode: mode,
          }),
        },
      );
      await loadConversations();
      setConversationId(data.conversation.id);
      setMessages([]);
      setActiveRunId(null);
      setRunEvents([]);
      router.push(`/chat/${data.conversation.id}`);
    } catch (createError) {
      const message =
        createError instanceof Error ? createError.message : String(createError);
      setError(message);
    }
  }

  async function openConversation(id: string) {
    try {
      setError(null);
      setConversationId(id);
      await loadMessages(id);
      router.push(`/chat/${id}`);
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : String(loadError);
      setError(message);
    }
  }

  async function sendChatStream(prompt: string) {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        conversationId: conversationId ?? undefined,
        userMessage: prompt,
        provider: provider === "auto" ? undefined : provider,
        modelId: modelId || undefined,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Chat request failed (${response.status})`);
    }

    const returnedConversationId = response.headers.get("x-conversation-id");
    if (returnedConversationId && returnedConversationId !== conversationId) {
      setConversationId(returnedConversationId);
      router.push(`/chat/${returnedConversationId}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Streaming response body missing");
    }

    const decoder = new TextDecoder();
    let collected = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      collected += decoder.decode(value, { stream: true });
      setStreamingAssistant(collected);
    }
    collected += decoder.decode();
    setStreamingAssistant("");

    setMessages((prev) => [...prev, { role: "assistant", text: collected }]);
    await loadConversations();
  }

  async function runAgent(prompt: string) {
    const data = await requestJson<{
      status: string;
      runId: string;
      conversationId: string;
      codingSessionId?: string;
      result?: { text?: string };
      approval?: { id?: string };
    }>("/api/agent/runs", {
      method: "POST",
      body: JSON.stringify({
        mode,
        userMessage: prompt,
        conversationId: conversationId ?? undefined,
        provider: provider === "auto" ? undefined : provider,
        modelId: modelId || undefined,
        repoFullName: mode === "coding" ? repoFullName : undefined,
        baseBranch: mode === "coding" ? baseBranch : undefined,
        codingSessionId: mode === "coding" ? codingSessionId : undefined,
      }),
    });

    if (!conversationId || data.conversationId !== conversationId) {
      setConversationId(data.conversationId);
      router.push(`/chat/${data.conversationId}`);
    }

    if (data.codingSessionId) {
      setCodingSessionId(data.codingSessionId);
    }

    setActiveRunId(data.runId);
    setRunStatus(data.status);
    await loadRunEvents(data.runId);
    await loadConversations();

    if (data.status === "approval_required" && data.approval?.id) {
      setPendingApproval({
        runId: data.runId,
        approvalId: data.approval.id,
      });
      return;
    }

    if (data.status === "completed") {
      const text = data.result?.text ?? "Run completed.";
      setMessages((prev) => [...prev, { role: "assistant", text }]);
    } else {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: `Run started in ${mode} mode. I will stream tool activity in the timeline.`,
        },
      ]);
    }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const prompt = input.trim();
    if (!prompt || isSending) {
      return;
    }

    try {
      setError(null);
      setFeedback(null);
      setIsSending(true);
      setInput("");
      setMessages((prev) => [...prev, { role: "user", text: prompt }]);

      if (mode === "chat") {
        await sendChatStream(prompt);
      } else {
        await runAgent(prompt);
      }
    } catch (sendError) {
      const message =
        sendError instanceof Error ? sendError.message : String(sendError);
      setError(message);
    } finally {
      setIsSending(false);
    }
  }

  async function approvePendingRun(approve: boolean) {
    if (!pendingApproval) {
      return;
    }

    try {
      setError(null);
      const data = await requestJson<{
        status: string;
        runId: string;
        result?: { text?: string };
        approval?: { id?: string };
      }>(`/api/agent/runs/${pendingApproval.runId}/approve`, {
        method: "POST",
        body: JSON.stringify({
          approvalId: pendingApproval.approvalId,
          approve,
          provider: provider === "auto" ? undefined : provider,
          modelId: modelId || undefined,
        }),
      });

      setRunStatus(data.status);
      await loadRunEvents(data.runId);

      if (!approve || data.status === "cancelled") {
        setPendingApproval(null);
        return;
      }

      if (data.status === "approval_required" && data.approval?.id) {
        setPendingApproval({
          runId: data.runId,
          approvalId: data.approval.id,
        });
        return;
      }

      setPendingApproval(null);

      if (data.status === "completed" && data.result?.text) {
        setMessages((prev) => [...prev, { role: "assistant", text: data.result!.text! }]);
      }
    } catch (approveError) {
      const message =
        approveError instanceof Error ? approveError.message : String(approveError);
      setError(message);
    }
  }

  async function signOut() {
    try {
      await requestJson<{ redirectTo: string }>("/api/auth/sign-out", {
        method: "POST",
      });
      router.push("/");
      router.refresh();
    } catch (signOutError) {
      const message =
        signOutError instanceof Error ? signOutError.message : String(signOutError);
      setError(message);
    }
  }

  return (
    <main className="min-h-screen px-4 py-4 md:px-6 md:py-6">
      <div className="mx-auto grid w-full max-w-[1600px] gap-4 lg:grid-cols-[280px_minmax(0,1fr)_360px]">
        <aside className="rounded-2xl border border-white/40 bg-white/70 p-4 shadow-[0_8px_30px_rgba(14,21,37,0.08)] backdrop-blur">
          <button
            type="button"
            onClick={createNewConversation}
            className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700"
          >
            New Chat
          </button>
          <input
            value={conversationQuery}
            onChange={(event) => setConversationQuery(event.target.value)}
            className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            placeholder="Search chats"
          />
          <div className="mt-4 max-h-[62vh] space-y-2 overflow-auto pr-1">
            {filteredConversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => openConversation(conversation.id)}
                className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                  conversation.id === conversationId
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white/80 text-slate-700 hover:border-slate-400"
                }`}
              >
                <p className="truncate text-sm font-medium">{conversation.title}</p>
                <p
                  className={`mt-1 line-clamp-2 text-xs ${
                    conversation.id === conversationId
                      ? "text-slate-200"
                      : "text-slate-500"
                  }`}
                >
                  {conversation.lastMessage
                    ? extractMessageText(conversation.lastMessage.contentJson)
                    : "No messages yet"}
                </p>
              </button>
            ))}
            {filteredConversations.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500">
                No conversations yet.
              </p>
            ) : null}
          </div>
        </aside>

        <section className="flex min-h-[80vh] flex-col rounded-2xl border border-white/40 bg-white/75 shadow-[0_8px_30px_rgba(14,21,37,0.08)] backdrop-blur">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 md:px-5">
            <div>
              <h1 className="text-lg font-semibold text-slate-900">
                {conversationId ? "Conversation" : "New Conversation"}
              </h1>
              <p className="text-xs text-slate-500">{props.user.email}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value as Mode)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700"
              >
                <option value="chat">Chat</option>
                <option value="agent">Agent</option>
                <option value="coding">Coding</option>
              </select>
              <select
                value={provider}
                onChange={(event) =>
                  setProvider(event.target.value as ProviderChoice)
                }
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700"
              >
                <option value="auto">Auto Provider</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
              </select>
              <select
                value={modelId}
                onChange={(event) => setModelId(event.target.value)}
                className="max-w-[210px] rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700"
              >
                {modelsPayload?.models?.map((model) => (
                  <option key={model.id} value={model.modelId}>
                    {model.displayName}
                  </option>
                ))}
                {!modelsPayload?.models?.length ? (
                  <option value="">No connected models</option>
                ) : null}
              </select>
              <Link
                href="/settings"
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:border-slate-400"
              >
                Settings
              </Link>
              <button
                type="button"
                onClick={signOut}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:border-slate-400"
              >
                Sign out
              </button>
            </div>
          </header>

          {mode === "coding" ? (
            <div className="grid gap-2 border-b border-slate-200 bg-slate-50/80 px-4 py-3 md:grid-cols-3 md:px-5">
              <input
                value={repoFullName}
                onChange={(event) => setRepoFullName(event.target.value)}
                placeholder="owner/repo"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              />
              <input
                value={baseBranch}
                onChange={(event) => setBaseBranch(event.target.value)}
                placeholder="base branch"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              />
              <input
                value={codingSessionId ?? ""}
                onChange={(event) =>
                  setCodingSessionId(event.target.value.trim() || null)
                }
                placeholder="existing coding session id (optional)"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              />
            </div>
          ) : null}

          <div className="flex-1 space-y-3 overflow-auto px-4 py-4 md:px-5">
            {messages.map((message, index) => (
              <article
                key={`${message.role}-${message.id ?? index}`}
                className={`max-w-[90%] rounded-2xl px-4 py-3 ${
                  message.role === "user"
                    ? "ml-auto bg-slate-900 text-white"
                    : "bg-white text-slate-800 shadow-sm ring-1 ring-slate-200"
                }`}
              >
                <p className="whitespace-pre-wrap text-sm leading-relaxed">
                  {message.text}
                </p>
                {message.createdAt ? (
                  <p
                    className={`mt-2 text-[11px] ${
                      message.role === "user" ? "text-slate-300" : "text-slate-500"
                    }`}
                  >
                    {shortTime(message.createdAt)}
                  </p>
                ) : null}
              </article>
            ))}
            {streamingAssistant ? (
              <article className="max-w-[90%] rounded-2xl bg-white px-4 py-3 text-slate-800 shadow-sm ring-1 ring-slate-200">
                <p className="whitespace-pre-wrap text-sm leading-relaxed">
                  {streamingAssistant}
                </p>
              </article>
            ) : null}
          </div>

          <footer className="border-t border-slate-200 px-4 py-4 md:px-5">
            <form onSubmit={sendMessage} className="flex gap-2">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={
                  mode === "coding"
                    ? "Describe the coding task and expected checks..."
                    : "Message the agent..."
                }
                className="h-20 flex-1 resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              />
              <button
                disabled={isSending}
                type="submit"
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
              >
                {isSending ? "Sending..." : "Send"}
              </button>
            </form>
            {feedback ? <p className="mt-2 text-xs text-emerald-600">{feedback}</p> : null}
            {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
          </footer>
        </section>

        <aside className="rounded-2xl border border-white/40 bg-white/75 p-4 shadow-[0_8px_30px_rgba(14,21,37,0.08)] backdrop-blur">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
              Agent Activity
            </h2>
            <button
              type="button"
              onClick={() => {
                if (!activeRunId) return;
                void Promise.resolve()
                  .then(async () => {
                    await Promise.all([loadRunEvents(activeRunId), syncRunState(activeRunId)]);
                  })
                  .catch((refreshError) => {
                    const message =
                      refreshError instanceof Error
                        ? refreshError.message
                        : String(refreshError);
                    setError(message);
                  });
              }}
              className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:border-slate-400"
            >
              Refresh
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Run: {activeRunId ?? "none"} | Status: {runStatus}
          </p>

          {pendingApproval ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-medium text-amber-800">
                Approval required
              </p>
              <p className="mt-1 text-xs text-amber-700">
                This run needs permission before continuing.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void approvePendingRun(true);
                  }}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void approvePendingRun(false);
                  }}
                  className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white"
                >
                  Reject
                </button>
              </div>
            </div>
          ) : null}

          <div className="mt-3 max-h-[70vh] space-y-2 overflow-auto pr-1">
            {runEvents.map((event) => (
              <article
                key={event.id}
                className="rounded-xl border border-slate-200 bg-white p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                    {event.type}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {shortTime(event.ts)}
                  </p>
                </div>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-slate-600">
                  {prettyJson(event.payload)}
                </pre>
              </article>
            ))}
            {runEvents.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-slate-500">
                No run events yet.
              </p>
            ) : null}
          </div>
        </aside>
      </div>
    </main>
  );
}
