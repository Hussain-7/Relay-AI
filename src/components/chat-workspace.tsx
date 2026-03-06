"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Streamdown } from "streamdown";

type StoredMode = "chat" | "agent" | "coding";

interface ConversationListItem {
  id: string;
  title: string;
  defaultMode: StoredMode;
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

  const [repoFullName, setRepoFullName] = useState("");
  const [baseBranch, setBaseBranch] = useState("main");
  const [codingSessionId, setCodingSessionId] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === conversationId) ?? null,
    [conversationId, conversations],
  );

  const gridColumnsClass = isSidebarCollapsed
    ? "lg:grid-cols-[72px_minmax(0,1fr)_320px]"
    : "lg:grid-cols-[260px_minmax(0,1fr)_320px]";

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
            defaultMode: "agent",
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
        mode: "agent",
        userMessage: prompt,
        conversationId: conversationId ?? undefined,
        modelId: modelId || undefined,
        repoFullName: repoFullName.trim() || undefined,
        baseBranch: repoFullName.trim()
          ? baseBranch.trim() || "main"
          : undefined,
        codingSessionId: codingSessionId?.trim() || undefined,
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
          text: "Run started. I will stream tool activity in the timeline.",
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
      await runAgent(prompt);
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
    <main className="min-h-screen bg-[radial-gradient(circle_at_16%_0%,#1f2430_0,#14161b_48%,#101217_100%)] px-3 py-3 text-slate-100 md:px-4 md:py-4 lg:h-screen lg:overflow-hidden">
      <div
        className={`mx-auto grid h-full w-full max-w-[1680px] gap-3 ${gridColumnsClass}`}
      >
        <aside className="flex min-h-0 flex-col rounded-2xl border border-white/10 bg-[#101319]/92 p-2 shadow-[0_12px_40px_rgba(0,0,0,0.32)] backdrop-blur">
          <div className="flex items-center justify-between px-2 pb-2 pt-1">
            <div className="grid size-9 place-items-center rounded-lg border border-white/15 bg-white/5 text-sm font-semibold text-slate-100">
              E
            </div>
            <button
              type="button"
              onClick={() => setIsSidebarCollapsed((current) => !current)}
              className="grid size-9 place-items-center rounded-lg border border-white/10 text-slate-400 transition hover:border-white/20 hover:text-slate-200"
              aria-label={
                isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
              }
            >
              <svg viewBox="0 0 20 20" className="size-4 fill-current" aria-hidden="true">
                <path d="M3.5 4A1.5 1.5 0 0 0 2 5.5v9A1.5 1.5 0 0 0 3.5 16h13a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 16.5 4h-13Zm0 1h3v10h-3a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5Z" />
              </svg>
            </button>
          </div>

          <button
            type="button"
            onClick={createNewConversation}
            className="mt-1 flex items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-100 transition hover:bg-white/5"
          >
            <span className="text-lg leading-none text-slate-300">+</span>
            {!isSidebarCollapsed ? <span>New chat</span> : null}
          </button>

          {!isSidebarCollapsed ? (
            <input
              value={conversationQuery}
              onChange={(event) => setConversationQuery(event.target.value)}
              className="mt-2 rounded-xl border border-white/10 bg-[#151922] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-white/25 focus:outline-none"
              placeholder="Search chats"
            />
          ) : null}

          <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="space-y-1.5">
              {filteredConversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => openConversation(conversation.id)}
                  title={conversation.title}
                  className={`w-full rounded-xl px-3 py-2 text-left text-sm transition ${
                    conversation.id === conversationId
                      ? "bg-[#1e2431] text-slate-100"
                      : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                  }`}
                >
                  {isSidebarCollapsed ? (
                    <span className="block text-center text-xs font-semibold uppercase tracking-wide">
                      {conversation.title.charAt(0)}
                    </span>
                  ) : (
                    <span className="block truncate">{conversation.title}</span>
                  )}
                </button>
              ))}
              {filteredConversations.length === 0 ? (
                <p className="rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-xs text-slate-500">
                  No chats yet.
                </p>
              ) : null}
            </div>
          </div>
        </aside>

        <section className="flex min-h-0 flex-col rounded-2xl border border-white/10 bg-[#141820]/92 shadow-[0_12px_40px_rgba(0,0,0,0.28)] backdrop-blur">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 md:px-5">
            <div className="min-w-0">
              <h1 className="truncate text-3xl font-medium tracking-tight text-slate-100">
                {activeConversation?.title ?? "New chat"}
              </h1>
              <p className="text-xs text-slate-500">{props.user.email}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/settings"
                className="rounded-lg border border-white/12 bg-[#1b2029] px-3 py-1.5 text-sm text-slate-200 transition hover:border-white/25"
              >
                Settings
              </Link>
              <button
                type="button"
                onClick={signOut}
                className="rounded-lg border border-white/12 bg-[#1b2029] px-3 py-1.5 text-sm text-slate-200 transition hover:border-white/25"
              >
                Sign out
              </button>
            </div>
          </header>

          <div className="grid gap-2 border-b border-white/10 bg-[#12161f]/80 px-4 py-3 md:grid-cols-3 md:px-5">
            <input
              value={repoFullName}
              onChange={(event) => setRepoFullName(event.target.value)}
              placeholder="owner/repo (optional)"
              className="rounded-lg border border-white/10 bg-[#1b2029] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-white/25 focus:outline-none"
            />
            <input
              value={baseBranch}
              onChange={(event) => setBaseBranch(event.target.value)}
              placeholder="base branch (optional)"
              className="rounded-lg border border-white/10 bg-[#1b2029] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-white/25 focus:outline-none"
            />
            <input
              value={codingSessionId ?? ""}
              onChange={(event) =>
                setCodingSessionId(event.target.value.trim() || null)
              }
              placeholder="existing coding session id (optional)"
              className="rounded-lg border border-white/10 bg-[#1b2029] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-white/25 focus:outline-none"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-5">
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
              {messages.map((message, index) => (
                <article
                  key={`${message.role}-${message.id ?? index}`}
                  className={`${
                    message.role === "user"
                      ? "ml-auto max-w-[86%] rounded-2xl bg-[#202637] px-4 py-3 text-slate-100"
                      : "mr-auto max-w-[94%] rounded-2xl border border-white/8 bg-[#10141d]/70 px-4 py-3 text-slate-200"
                  }`}
                >
                  <Streamdown
                    mode="static"
                    controls={false}
                    className={`text-sm leading-relaxed ${
                      message.role === "user"
                        ? "text-slate-100 [&_a]:text-slate-100 [&_code]:bg-white/10 [&_pre]:bg-[#0f1421]"
                        : "text-slate-200 [&_a]:text-slate-100 [&_code]:bg-white/8 [&_pre]:bg-[#0d1118]"
                    }`}
                  >
                    {message.text}
                  </Streamdown>
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
            </div>
          </div>

          <footer className="border-t border-white/10 px-4 pb-4 pt-3 md:px-5">
            <form
              onSubmit={sendMessage}
              className="mx-auto w-full max-w-4xl rounded-[22px] border border-white/10 bg-[#0f131d] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
            >
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Ask for follow-up changes..."
                  className="h-14 w-full resize-none border-0 bg-transparent px-1 py-1 text-[15px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
                />
              <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="grid size-8 place-items-center rounded-full border border-white/12 text-lg text-slate-300 transition hover:border-white/25 hover:text-slate-100"
                    aria-label="Attach context (coming soon)"
                    title="Attach context (coming soon)"
                  >
                    +
                  </button>
                  <select
                    value={modelId}
                    onChange={(event) => setModelId(event.target.value)}
                    className="max-w-[190px] rounded-lg border border-white/12 bg-[#171d28] px-2.5 py-1.5 text-xs text-slate-200 focus:border-white/25 focus:outline-none"
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
                </div>
                <button
                  disabled={isSending}
                  type="submit"
                  className="grid size-9 place-items-center rounded-full bg-slate-200 text-slate-900 transition hover:bg-white disabled:opacity-50"
                  aria-label={isSending ? "Sending message" : "Send message"}
                >
                  {isSending ? (
                    <span className="text-xs font-semibold">...</span>
                  ) : (
                    <svg
                      viewBox="0 0 20 20"
                      aria-hidden="true"
                      className="size-4 fill-current"
                    >
                      <path d="M10.75 3a.75.75 0 0 0-1.5 0v10.19L6.53 10.47a.75.75 0 0 0-1.06 1.06l4 4a.75.75 0 0 0 1.06 0l4-4a.75.75 0 0 0-1.06-1.06l-2.72 2.72V3z" />
                    </svg>
                  )}
                </button>
              </div>
            </form>
            {feedback ? <p className="mt-2 text-xs text-emerald-400">{feedback}</p> : null}
            {error ? <p className="mt-2 text-xs text-rose-400">{error}</p> : null}
          </footer>
        </section>

        <aside className="flex min-h-0 flex-col rounded-2xl border border-white/10 bg-[#11151c]/92 p-4 shadow-[0_12px_40px_rgba(0,0,0,0.3)] backdrop-blur">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
              Agent Activity
            </h2>
            <button
              type="button"
              onClick={() => {
                if (!activeRunId) return;
                void Promise.resolve()
                  .then(async () => {
                    await Promise.all([
                      loadRunEvents(activeRunId),
                      syncRunState(activeRunId),
                    ]);
                  })
                  .catch((refreshError) => {
                    const message =
                      refreshError instanceof Error
                        ? refreshError.message
                        : String(refreshError);
                    setError(message);
                  });
              }}
              className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-slate-300 transition hover:border-white/25"
            >
              Refresh
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Run: {activeRunId ?? "none"} | Status: {runStatus}
          </p>

          {pendingApproval ? (
            <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-400/10 p-3">
              <p className="text-xs font-medium text-amber-200">Approval required</p>
              <p className="mt-1 text-xs text-amber-100/80">
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

          <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {runEvents.map((event) => (
              <article
                key={event.id}
                className="rounded-xl border border-white/10 bg-[#161b25] p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                    {event.type}
                  </p>
                  <p className="text-[11px] text-slate-500">{shortTime(event.ts)}</p>
                </div>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-slate-400">
                  {prettyJson(event.payload)}
                </pre>
              </article>
            ))}
            {runEvents.length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-xs text-slate-500">
                No run events yet.
              </p>
            ) : null}
          </div>
        </aside>
      </div>
    </main>
  );
}
